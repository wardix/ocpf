import { verify } from 'hono/jwt';
import { JWT_SECRET } from '../middleware/auth';
import type { ServerWebSocket } from 'bun';

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
  message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    if (message === 'ping') {
      ws.send('pong');
      ws.data.isAlive = true;
    }
  },
  close(ws: ServerWebSocket<WebSocketData>) {
    console.log(`[WS] User ${ws.data.userId} Terputus ❌`);
    activeWebSockets.delete(ws);
  },
};
