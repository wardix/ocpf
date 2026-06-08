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
        if (payload.event === 'conversation.viewing') {
          const { conversation_id } = payload.data;
          if (conversation_id) {
            const userId = ws.data.userId;
            const name = ws.data.name;
            const viewKey = `viewing:${conversation_id}:${userId}`;
            const setKey = `viewers:${conversation_id}`;
            
            // Set expire on individual user viewing status (15s TTL)
            await redis.setex(viewKey, 15, name);
            // Add user to the set of viewers
            await redis.sadd(setKey, userId.toString());

            // Get current active viewers
            const userIds = await redis.smembers(setKey);
            const activeViewers = [];

            for (const uid of userIds) {
              const uName = await redis.get(`viewing:${conversation_id}:${uid}`);
              if (uName) {
                activeViewers.push({ id: Number(uid), name: uName });
              } else {
                // Remove stale viewers from set
                await redis.srem(setKey, uid);
              }
            }

            // Broadcast to other agents
            await redis.publish('chat:events', JSON.stringify({
              event: 'conversation.viewers_updated',
              data: {
                account_id: ws.data.accountId,
                conversation_id,
                viewers: activeViewers
              }
            }));
          }
        }

        if (payload.event === 'conversation.left') {
          const { conversation_id } = payload.data;
          if (conversation_id) {
            const userId = ws.data.userId;
            const viewKey = `viewing:${conversation_id}:${userId}`;
            const setKey = `viewers:${conversation_id}`;

            await redis.del(viewKey);
            await redis.srem(setKey, userId.toString());

            // Get current active viewers
            const userIds = await redis.smembers(setKey);
            const activeViewers = [];

            for (const uid of userIds) {
              const uName = await redis.get(`viewing:${conversation_id}:${uid}`);
              if (uName) {
                activeViewers.push({ id: Number(uid), name: uName });
              } else {
                await redis.srem(setKey, uid);
              }
            }

            // Broadcast to other agents
            await redis.publish('chat:events', JSON.stringify({
              event: 'conversation.viewers_updated',
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
  close(ws: ServerWebSocket<any>) {
    console.log(`[WS] ${ws.data.isWidget ? 'Widget Session ' + ws.data.sessionToken : 'User ' + ws.data.userId} Terputus ❌`);
    activeWebSockets.delete(ws);

    if (!ws.data.isWidget) {
      // Auto-offline
      import('../config/database').then(({ sql }) => {
        sql`
          UPDATE account_users SET availability_status = 'offline'
          WHERE user_id = ${ws.data.userId} AND account_id = ${ws.data.accountId}
        `.catch(err => console.error('Error auto-offline:', err));
      });

      redis.publish('chat:events', JSON.stringify({
        event: 'agent.availability_changed',
        data: { 
          account_id: ws.data.accountId,
          user_id: ws.data.userId, 
          availability_status: 'offline' 
        }
      })).catch(err => console.error('Error publish offline:', err));
    }
  },
};
