import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import { startWorker } from './workers/incoming-message';
import { startSnoozeChecker } from './workers/snooze-checker';
import { startCSATWorker } from './workers/csat-worker';
import { startWebhookWorker } from './workers/webhook-worker';
import { startIdleTracker } from './workers/idle-tracker';
import { startScheduledMessagesWorker } from './workers/scheduled-messages-worker';
import { startExportWorker } from './workers/export-worker';
import { websocketHandlers, setupWebSocket } from './websocket/handler';
import { redis, redisSub, redisWorker, redisWebhookWorker, PUB_SUB_CH } from './config/redis';
import { activeWebSockets } from './websocket/handler';
import { rateLimiter } from './middleware/rate-limiter';

import { sql } from './config/database';
// Import Routes
import { authRoutes } from './routes/auth';
import { contactsRoutes } from './routes/contacts';
import { conversationsRoutes } from './routes/conversations';
import { messagesRoutes } from './routes/messages';
import { usersRoutes } from './routes/users';
import { cannedResponsesRoutes } from './routes/canned_responses';
import { analyticsRoutes } from './routes/analytics';
import broadcastRoutes from './routes/broadcast'; 
import docsRoutes from './routes/docs';
import { labelsRoutes } from './routes/labels';
import { searchRoutes } from './routes/search';
import { inboxesRoutes } from './routes/inboxes';
import { widgetRoutes } from './routes/widget';
import { chatbotRoutes } from './routes/chatbot';
import { webhooksRoutes } from './routes/webhooks';
import { aiRoutes } from './routes/ai';
import { automationRoutes } from './routes/automation';
import { scheduledMessagesRoutes } from './routes/scheduled_messages';
import { messageTemplatesRoutes } from './routes/message_templates';
import { exportsRoutes } from './routes/exports';
import { apiKeysRoutes } from './routes/api_keys';
import { channelsRoutes } from './routes/channels';
import { teamsRoutes } from './routes/teams';
import { notificationsRoutes } from './routes/notifications';

import { monitorMiddleware, registry } from './utils/monitoring';
import * as Sentry from '@sentry/bun';

export const app = new Hono();

// Capture uncaught exceptions using Sentry
app.onError((err, c) => {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  console.error('[Hono Error Handler]', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Register Prometheus and Structured Logging Middleware
app.use('*', monitorMiddleware);

// Setup CORS Configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(o => o.trim());

const corsOptions = {
  origin: (origin: string | undefined) => {
    // Izinkan requests tanpa origin (misalnya, aplikasi mobile atau server-to-server) 
    // jika kita tidak dalam mode strict, tapi untuk keamanan API web, idealnya divalidasi
    if (!origin) return allowedOrigins[0];
    
    if (allowedOrigins.includes(origin)) {
      return origin;
    }
    // Fallback jika tidak match
    return null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
  exposeHeaders: ['Retry-After'],
  credentials: true,
  maxAge: 86400, // Cache preflight requests selama 24 jam
};

// Global Middleware
app.use('/api/widget/*', async (c, next) => {
  const origin = c.req.header('origin');
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Credentials', 'true');
  }
  if (c.req.method === 'OPTIONS') {
    return c.text('OK');
  }
  await next();
});

app.use('/api/*', cors(corsOptions));
app.use('/ws', cors(corsOptions));

// General Rate Limiter: 100 requests per minute per IP
app.use('/api/*', rateLimiter({
  windowMs: 60 * 1000, 
  max: 100,
  keyGenerator: (c) => {
    const apiKey = c.req.header('x-api-key');
    if (apiKey) return `apikey:${apiKey.slice(0, 15)}`; // Use prefix
    const ip = c.req.header('x-forwarded-for') || 'unknown-ip';
    return `general:${ip}`;
  }
}));

// Static Files
app.use('/uploads/*', serveStatic({ root: './public' }));
app.use('/widget.js', serveStatic({ path: './public/widget.js' }));

// Health Check
app.get('/', (c) => c.text('Main API Omnichannel (Bun + Hono + WebSocket) ✅'));

app.get('/healthz', async (c) => {
  let dbStatus = 'ok';
  let redisStatus = 'ok';

  try {
    await sql`SELECT 1`;
  } catch (err) {
    dbStatus = 'fail';
  }

  try {
    await redis.ping();
  } catch (err) {
    redisStatus = 'fail';
  }

  const isOk = dbStatus === 'ok' && redisStatus === 'ok';

  return c.json({
    status: isOk ? 'ok' : 'fail',
    db: dbStatus,
    redis: redisStatus,
    uptime: process.uptime()
  }, isOk ? 200 : 500);
});

// Prometheus Metrics Endpoint
app.get('/metrics', async (c) => {
  c.header('Content-Type', registry.contentType);
  return c.text(await registry.metrics());
});

// Register Routes
app.route('/api/auth', authRoutes);
app.route('/api/contacts', contactsRoutes);
app.route('/api/conversations', conversationsRoutes);
app.route('/api/messages', messagesRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/canned-responses', cannedResponsesRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/broadcast', broadcastRoutes);
app.route('/api/labels', labelsRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/inboxes', inboxesRoutes);
app.route('/api/widget', widgetRoutes);
app.route('/api/chatbot', chatbotRoutes);
app.route('/api/webhooks', webhooksRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/automation-rules', automationRoutes);
app.route('/api/docs', docsRoutes);
app.route('/api/scheduled-messages', scheduledMessagesRoutes);
app.route('/api/message-templates', messageTemplatesRoutes);
app.route('/api/exports', exportsRoutes);
app.route('/api/api-keys', apiKeysRoutes);
app.route('/api/channels', channelsRoutes);
app.route('/api/teams', teamsRoutes);
app.route('/api/notifications', notificationsRoutes);

// Setup Pub/Sub Broadcaster for WebSockets
redisSub.subscribe(PUB_SUB_CH);
redisSub.on('message', async (channel, message) => {
  if (channel === PUB_SUB_CH) {
    try {
      const payload = JSON.parse(message);
      
      if (payload.event === 'typing.update') {
        const { jid, is_typing } = payload.data;
        // Lookup contact and conversation
        const [contact] = await sql`
          SELECT c.account_id, c.id as contact_id, c.name, conv.id as conversation_id 
          FROM contacts c 
          JOIN conversations conv ON conv.contact_id = c.id
          WHERE c.phone_number = ${jid} AND c.deleted_at IS NULL LIMIT 1
        `;
        if (contact) {
          const typingMsg = JSON.stringify({
            event: 'typing.update',
            data: {
              conversation_id: contact.conversation_id,
              contact_id: contact.contact_id,
              contact_name: contact.name,
              is_typing
            }
          });
          activeWebSockets.forEach((ws) => {
            if (ws.data.accountId === contact.account_id) {
              ws.send(typingMsg);
            }
          });
        }
        return;
      }

      const { data } = payload;
      const accountId = data?.account_id || 1;
      const isPrivate = data?.is_private || false;

      activeWebSockets.forEach((ws: any) => {
        if (ws.data.isWidget) {
          if (payload.event === 'message.new' && ws.data.conversationId === data?.conversation_id) {
            ws.send(message);
          } else if (payload.event === 'typing.update' && ws.data.conversationId === data?.conversation_id) {
            ws.send(message);
          }
          return;
        }

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
startSnoozeChecker();
startCSATWorker();
startWebhookWorker();
startIdleTracker();
startScheduledMessagesWorker();
startExportWorker();

// Bun HTTP + WebSocket Server
const server = Bun.serve({
  port: process.env.NODE_ENV === 'test' ? 0 : (Number(process.env.PORT) || 3000),
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const token = url.searchParams.get('token');
      if (!token) return new Response('Unauthorized: Token required', { status: 401 });

      try {
        const { verify } = await import('hono/jwt');
        const { JWT_SECRET } = await import('./middleware/auth');
        const payload = await verify(token, JWT_SECRET, 'HS256') as any;
        
        const upgradeSuccess = (server as any).upgrade(req, {
          data: {
            accountId: payload.account_id, 
            userId: payload.id,
            name: payload.name,
            role: payload.role,
            isAlive: true
          }
        });
        
        if (upgradeSuccess) return;
        return new Response('Upgrade failed', { status: 500 });
      } catch (e: any) {
        console.error(`[WS] Upgrade Token Error: ${e.message}`);
        return new Response('Unauthorized: Invalid token', { status: 401 });
      }
    } else if (url.pathname === '/ws/widget') {
      const token = url.searchParams.get('token');
      if (!token) return new Response('Unauthorized: Token required', { status: 401 });

      try {
        const [session] = await sql`
          SELECT account_id, inbox_id, contact_id, conversation_id 
          FROM widget_sessions 
          WHERE session_token = ${token} LIMIT 1
        `;
        if (!session) return new Response('Unauthorized: Invalid token', { status: 401 });

        const upgradeSuccess = (server as any).upgrade(req, {
          data: {
            accountId: Number(session.account_id),
            inboxId: Number(session.inbox_id),
            contactId: Number(session.contact_id),
            conversationId: Number(session.conversation_id),
            sessionToken: token,
            isAlive: true,
            isWidget: true
          }
        });
        
        if (upgradeSuccess) return;
        return new Response('Upgrade failed', { status: 500 });
      } catch (e: any) {
        console.error(`[WS/Widget] Upgrade Token Error: ${e.message}`);
        return new Response('Server error during upgrade', { status: 500 });
      }
    }
    return app.fetch(req);
  },
  websocket: websocketHandlers
});

setupWebSocket(server);

console.log(`Server API & WebSocket berjalan di port ${server.port}`);

// =========================================================================
// GRACEFUL SHUTDOWN HANDLERS
// =========================================================================
async function handleShutdown(signal: string) {
  if ((globalThis as any).isShuttingDown) return;
  console.log(`\n[SHUTDOWN] Menerima sinyal ${signal}. Menutup proses secara anggun...`);
  (globalThis as any).isShuttingDown = true;

  try {
    // 1. Stop Bun Serve HTTP/WS Server
    server.stop();
    console.log('[SHUTDOWN] HTTP & WebSocket server dihentikan.');

    // 2. Tutup semua koneksi WebSocket aktif
    console.log(`[SHUTDOWN] Menutup ${activeWebSockets.size} koneksi WebSocket aktif...`);
    activeWebSockets.forEach((ws) => {
      try {
        ws.close(1012, 'Server is shutting down');
      } catch (err) {
        // Abaikan error jika WS sudah tertutup
      }
    });
    activeWebSockets.clear();

    // 3. Tutup koneksi Redis
    console.log('[SHUTDOWN] Menutup koneksi Redis...');
    await redis.quit();
    await redisSub.quit();
    await redisWorker.quit();
    await redisWebhookWorker.quit();

    // 4. Tutup pool koneksi database PostgreSQL
    console.log('[SHUTDOWN] Menutup pool koneksi PostgreSQL...');
    await sql.end();

    console.log('[SHUTDOWN] Semua layanan main-api terputus dengan bersih. Goodbye! 👋');
    process.exit(0);
  } catch (err) {
    console.error('[SHUTDOWN] Terjadi kesalahan saat menutup layanan main-api:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
