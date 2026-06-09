import { verify } from 'hono/jwt';
import { JWT_SECRET } from '../middleware/auth';
import type { ServerWebSocket } from 'bun';
import { redis } from '../config/redis';
import { SendTypingPayloadSchema } from '@omnichannel/shared-types';

export type WebSocketData = {
  accountId: number;
  userId: number;
  name: string;
  role: string;
  isAlive: boolean;
};

export const activeWebSockets = new Set<ServerWebSocket<WebSocketData>>();

export function setupWebSocket(server: any) {
  // Heartbeat Interval untuk membersihkan koneksi stale/mati
  setInterval(() => {
    activeWebSockets.forEach((ws) => {
      if (!ws.data.isAlive) {
        console.log(`[WS] Terminating stale connection for User ${ws.data.userId}`);
        ws.close();
        activeWebSockets.delete(ws);
        return;
      }
      ws.data.isAlive = false; // Reset, expecting pong
      ws.send('ping');
    });
  }, 30000);
}

export const websocketHandlers = {
  open(ws: ServerWebSocket<any>) {
    console.log(`[WS] ${ws.data.isWidget ? 'Widget Session ' + ws.data.sessionToken : 'User ' + ws.data.userId} Terhubung 🌐`);
    activeWebSockets.add(ws);
  },
  async message(ws: ServerWebSocket<any>, message: string | Buffer) {
    if (typeof message === 'string') {
      if (message === 'pong' || message === 'ping') {
        if (message === 'ping') ws.send('pong');
        ws.data.isAlive = true;
        return;
      }

      try {
        const payload = JSON.parse(message);
        const eventType = payload.event || payload.type;
        const data = payload.data || payload;

        if (ws.data.isWidget) {
          // Tangani event typing dari widget visitor
          if (payload.event === 'typing.widget') {
            const { is_typing } = payload.data;
            await redis.publish('chat:events', JSON.stringify({
              event: 'typing.update',
              data: {
                conversation_id: ws.data.conversationId,
                contact_id: ws.data.contactId,
                is_typing
              }
            }));
          }
          return;
        }

        if (payload.event === 'typing.agent') {
          const { inbox_id, phone } = payload.data;
          
          let cleanPhone = phone.replace(/[^\d-]/g, '');
          if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.substring(1);
          const isGroup = cleanPhone.includes('-') || cleanPhone.length > 15;
          const jid = cleanPhone + (isGroup ? '@g.us' : '@s.whatsapp.net');

          const typingPayload = {
            event: 'typing.send',
            data: { inbox_id, jid }
          };

          const targetQueue = `queue:outgoing_messages:inbox_${inbox_id}`;
          await redis.rpush(targetQueue, JSON.stringify(SendTypingPayloadSchema.parse(typingPayload)));

          // Juga publish typing status ke Redis Pub/Sub agar widget visitor menerima typing status
          import('../config/database').then(async ({ sql }) => {
            try {
              const [conv] = await sql`
                SELECT c.id as conversation_id, c.contact_id 
                FROM conversations c 
                JOIN contacts con ON c.contact_id = con.id 
                WHERE con.phone_number = ${phone} AND c.inbox_id = ${inbox_id} LIMIT 1
              `;
              if (conv) {
                await redis.publish('chat:events', JSON.stringify({
                  event: 'typing.update',
                  data: {
                    conversation_id: Number(conv.conversation_id),
                    contact_id: Number(conv.contact_id),
                    is_typing: true
                  }
                }));
              }
            } catch (e) {
              console.error('Error publishing agent typing status:', e);
            }
          });
        }

        // --- COLLISION DETECTION EVENTS ---
        if (eventType === 'conversation.viewing') {
          const conversation_id = Number(data.conversation_id);
          if (conversation_id) {
            const userId = ws.data.userId;
            const name = ws.data.name;
            const key = `viewing:conversation:${conversation_id}`;
            const memberObj = JSON.stringify({ id: userId, name: name });

            // Add viewer to sorted set
            await redis.zadd(key, Date.now(), memberObj);
            await redis.expire(key, 20); // auto-expire key in 20s if no updates

            ws.data.viewingConversationId = conversation_id;

            // Prune stale viewers (>15 seconds old)
            const minScore = Date.now() - 15000;
            await redis.zremrangebyscore(key, '-inf', minScore);

            // Get active viewers
            const members = await redis.zrange(key, 0, -1);
            const activeViewers = members.map(m => JSON.parse(m));

            // Broadcast to other agents (supporting both formats)
            await redis.publish('chat:events', JSON.stringify({
              event: 'conversation.viewers_updated',
              type: 'conversation.viewers',
              conversation_id,
              viewers: activeViewers,
              data: {
                account_id: ws.data.accountId,
                conversation_id,
                viewers: activeViewers
              }
            }));
          }
        }

        if (eventType === 'conversation.left') {
          const conversation_id = Number(data.conversation_id);
          if (conversation_id) {
            const userId = ws.data.userId;
            const name = ws.data.name;
            const key = `viewing:conversation:${conversation_id}`;
            const memberObj = JSON.stringify({ id: userId, name: name });

            await redis.zrem(key, memberObj);

            if (ws.data.viewingConversationId === conversation_id) {
              ws.data.viewingConversationId = undefined;
            }

            // Prune stale viewers (>15 seconds old)
            const minScore = Date.now() - 15000;
            await redis.zremrangebyscore(key, '-inf', minScore);

            // Get active viewers
            const members = await redis.zrange(key, 0, -1);
            const activeViewers = members.map(m => JSON.parse(m));

            // Broadcast to other agents
            await redis.publish('chat:events', JSON.stringify({
              event: 'conversation.viewers_updated',
              type: 'conversation.viewers',
              conversation_id,
              viewers: activeViewers,
              data: {
                account_id: ws.data.accountId,
                conversation_id,
                viewers: activeViewers
              }
            }));
          }
        }
      } catch (e) {
        // Abaikan parse error
      }
    }
  },
  async close(ws: ServerWebSocket<any>) {
    console.log(`[WS] ${ws.data.isWidget ? 'Widget Session ' + ws.data.sessionToken : 'User ' + ws.data.userId} Terputus ❌`);
    activeWebSockets.delete(ws);

    if (!ws.data.isWidget) {
      // Clean up collision detection viewing state immediately on disconnect
      const conversationId = ws.data.viewingConversationId;
      if (conversationId) {
        const userId = ws.data.userId;
        const name = ws.data.name;
        const key = `viewing:conversation:${conversationId}`;
        const memberObj = JSON.stringify({ id: userId, name: name });

        try {
          await redis.zrem(key, memberObj);

          // Prune stale viewers (>15 seconds old)
          const minScore = Date.now() - 15000;
          await redis.zremrangebyscore(key, '-inf', minScore);

          // Get active viewers
          const members = await redis.zrange(key, 0, -1);
          const activeViewers = members.map(m => JSON.parse(m));

          // Broadcast to other agents
          await redis.publish('chat:events', JSON.stringify({
            event: 'conversation.viewers_updated',
            type: 'conversation.viewers',
            conversation_id: conversationId,
            viewers: activeViewers,
            data: {
              account_id: ws.data.accountId,
              conversation_id: conversationId,
              viewers: activeViewers
            }
          }));
        } catch (err) {
          console.error('Error cleaning up viewing presence on close:', err);
        }
      }

      // Auto-offline
      import('../config/database').then(({ sql }) => {
        sql`
          UPDATE account_users SET availability_status = 'offline'
          WHERE user_id = ${ws.data.userId} AND account_id = ${ws.data.accountId}
        `.catch((err: any) => console.error('Error auto-offline:', err));
      });

      redis.publish('chat:events', JSON.stringify({
        event: 'agent.availability_changed',
        data: { 
          account_id: ws.data.accountId,
          user_id: ws.data.userId, 
          availability_status: 'offline' 
        }
      })).catch((err: any) => console.error('Error publish offline:', err));
    }
  },
};
