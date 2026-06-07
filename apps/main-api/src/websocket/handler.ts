import { verify } from 'hono/jwt';
import { JWT_SECRET } from '../middleware/auth';
import type { ServerWebSocket } from 'bun';
import { redis } from '../config/redis';
import { SendTypingPayloadSchema } from '@omnichannel/shared-types';

export type WebSocketData = {
  accountId: number;
  userId: number;
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
  open(ws: ServerWebSocket<WebSocketData>) {
    console.log(`[WS] User ${ws.data.userId} (Role: ${ws.data.role}) Terhubung 🌐`);
    activeWebSockets.add(ws);
  },
  async message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    if (typeof message === 'string') {
      if (message === 'pong' || message === 'ping') {
        if (message === 'ping') ws.send('pong');
        ws.data.isAlive = true;
        return;
      }

      try {
        const payload = JSON.parse(message);
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
        }
      } catch (e) {
        // Abaikan parse error
      }
    }
  },
  close(ws: ServerWebSocket<WebSocketData>) {
    console.log(`[WS] User ${ws.data.userId} Terputus ❌`);
    activeWebSockets.delete(ws);

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
  },
};
