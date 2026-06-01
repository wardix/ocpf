import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import { startWorker } from './workers/incoming-message';
import { websocketHandlers, setupWebSocket } from './websocket/handler';
import { PORT } from './config/database';
import { redisSub, PUB_SUB_CH } from './config/redis';
import { activeWebSockets } from './websocket/handler';

// Import Routes
import { authRoutes } from './routes/auth';
import { contactsRoutes } from './routes/contacts';
import { conversationsRoutes } from './routes/conversations';
import { messagesRoutes } from './routes/messages';
import { usersRoutes } from './routes/users';
import { cannedResponsesRoutes } from './routes/canned_responses';
import { analyticsRoutes } from './routes/analytics';
import broadcastRoutes from './routes/broadcast'; // broadcast.ts menggunakan export default app;

const app = new Hono();

// Global Middleware
app.use('/api/*', cors());
app.use('/ws', cors());

// Static Files
app.use('/uploads/*', serveStatic({ root: './public' }));

// Health Check
app.get('/', (c) => c.text('Main API Omnichannel (Bun + Hono + WebSocket) ✅'));

// Register Routes
app.route('/api/auth', authRoutes);
app.route('/api/contacts', contactsRoutes);
app.route('/api/conversations', conversationsRoutes);
app.route('/api/messages', messagesRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/canned-responses', cannedResponsesRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/broadcast', broadcastRoutes);

// Setup Pub/Sub Broadcaster for WebSockets
redisSub.subscribe(PUB_SUB_CH);
redisSub.on('message', (channel, message) => {
  if (channel === PUB_SUB_CH) {
    try {
      const payload = JSON.parse(message);
      const { data } = payload;
      const accountId = data?.account_id || 1;
      const isPrivate = data?.is_private || false;

      activeWebSockets.forEach((ws) => {
        if (ws.data.accountId !== accountId) return;
        if (isPrivate && ws.data.role !== 'agent' && ws.data.role !== 'administrator') return;
        ws.send(message);
      });
    } catch (e) {
      console.error('Broadcast error:', e);
    }
  }
});

// Start Background Worker
startWorker();

// Bun HTTP + WebSocket Server
const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const token = url.searchParams.get('token');
      if (!token) return new Response('Unauthorized: Token required', { status: 401 });

      try {
        const { verify } = await import('hono/jwt');
        const { JWT_SECRET } = await import('./middleware/auth');
        const payload = await verify(token, JWT_SECRET, 'HS256') as any;
        
        const upgradeSuccess = server.upgrade(req, {
          data: {
            accountId: payload.account_id, 
            userId: payload.id,
            role: payload.role,
            isAlive: true
          }
        });
        
        if (upgradeSuccess) return;
        return new Response('Upgrade failed', { status: 500 });
      } catch (e: any) {
        console.error('WS Upgrade Token Error:', e);
        return new Response('Unauthorized: Invalid token ' + e.message, { status: 401 });
      }
    }
    return app.fetch(req);
  },
  websocket: websocketHandlers
});

setupWebSocket(server);

console.log(`Server API & WebSocket berjalan di port ${server.port}`);
