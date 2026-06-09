import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { redis } from '../config/redis';
import { authMiddleware, getAccountId } from '../middleware/auth';
import crypto from 'crypto';

export const webhooksRoutes = new Hono();

webhooksRoutes.use('/*', authMiddleware);

const allowedEvents = [
  'conversation.created',
  'conversation.resolved',
  'message.incoming',
  'message.outgoing',
  'contact.created'
];

const webhookSchema = z.object({
  url: z.string().url('Format URL tidak valid').max(2048),
  events: z.array(z.string()).min(1, 'Pilih minimal satu event'),
  active: z.boolean().optional(),
  description: z.string().max(500).optional().nullable()
});

// GET /api/webhooks - List webhooks for account
webhooksRoutes.get('/', async (c) => {
  try {
    const accountId = getAccountId(c);
    const webhooks = await sql`
      SELECT * FROM webhooks
      WHERE account_id = ${accountId}
      ORDER BY created_at DESC
    `;
    return c.json({ success: true, data: webhooks });
  } catch (error) {
    console.error('Error fetch webhooks:', error);
    return c.json({ error: 'Gagal mengambil daftar webhook' }, 500);
  }
});

// GET /api/webhooks/:id - Get single webhook details
webhooksRoutes.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const [webhook] = await sql`
      SELECT * FROM webhooks
      WHERE id = ${id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!webhook) return c.json({ error: 'Webhook tidak ditemukan' }, 404);
    return c.json({ success: true, data: webhook });
  } catch (error) {
    console.error('Error fetch webhook details:', error);
    return c.json({ error: 'Gagal mengambil detail webhook' }, 500);
  }
});

// POST /api/webhooks - Create a new webhook (Admin only)
webhooksRoutes.post('/', zValidator('json', webhookSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const { url, events, active, description } = c.req.valid('json');

    // Validate events list
    const invalidEvents = events.filter((e: any) => !allowedEvents.includes(e));
    if (invalidEvents.length > 0) {
      return c.json({ error: `Event berikut tidak didukung: ${invalidEvents.join(', ')}` }, 400);
    }

    // Generate random secret
    const secret = crypto.randomBytes(24).toString('hex');

    const [webhook] = await sql`
      INSERT INTO webhooks (account_id, url, events, secret, active, description)
      VALUES (${accountId}, ${url}, ${events}, ${secret}, ${active !== undefined ? active : true}, ${description || null})
      RETURNING *
    `;

    return c.json({ success: true, data: webhook }, 201);
  } catch (error) {
    console.error('Error create webhook:', error);
    return c.json({ error: 'Gagal membuat webhook' }, 500);
  }
});

// PUT /api/webhooks/:id - Update webhook (Admin only)
webhooksRoutes.put('/:id', zValidator('json', webhookSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const { url, events, active, description } = c.req.valid('json');

    // Validate events list
    const invalidEvents = events.filter((e: any) => !allowedEvents.includes(e));
    if (invalidEvents.length > 0) {
      return c.json({ error: `Event berikut tidak didukung: ${invalidEvents.join(', ')}` }, 400);
    }

    const [webhook] = await sql`
      UPDATE webhooks
      SET url = ${url},
          events = ${events},
          active = ${active !== undefined ? active : true},
          description = ${description || null},
          updated_at = NOW()
      WHERE id = ${id} AND account_id = ${accountId}
      RETURNING *
    `;

    if (!webhook) return c.json({ error: 'Webhook tidak ditemukan' }, 404);

    return c.json({ success: true, data: webhook });
  } catch (error) {
    console.error('Error update webhook:', error);
    return c.json({ error: 'Gagal memperbarui webhook' }, 500);
  }
});

// DELETE /api/webhooks/:id - Delete webhook (Admin only)
webhooksRoutes.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const [deleted] = await sql`
      DELETE FROM webhooks
      WHERE id = ${id} AND account_id = ${accountId}
      RETURNING id
    `;

    if (!deleted) return c.json({ error: 'Webhook tidak ditemukan' }, 404);

    return c.json({ success: true, message: 'Webhook berhasil dihapus' });
  } catch (error) {
    console.error('Error delete webhook:', error);
    return c.json({ error: 'Gagal menghapus webhook' }, 500);
  }
});

// POST /api/webhooks/:id/test - Send a test ping event (Admin only)
webhooksRoutes.post('/:id/test', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const [webhook] = await sql`
      SELECT id, url, secret FROM webhooks
      WHERE id = ${id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!webhook) return c.json({ error: 'Webhook tidak ditemukan' }, 404);

    const testPayload = {
      event: 'webhook.ping',
      timestamp: new Date().toISOString(),
      message: 'Hello, this is a test notification from the Omnichannel Support Platform! 👋',
      test: true
    };

    const task = {
      webhookId: Number(webhook.id),
      url: webhook.url,
      secret: webhook.secret,
      eventType: 'webhook.ping',
      payload: testPayload,
      attempt: 1
    };

    // Push directly to execution queue
    await redis.lpush('queue:webhook_deliveries', JSON.stringify(task));

    return c.json({ success: true, message: 'Test ping event berhasil dijadwalkan!' });
  } catch (error) {
    console.error('Error test webhook:', error);
    return c.json({ error: 'Gagal mengirim test webhook' }, 500);
  }
});

// GET /api/webhooks/:id/deliveries - Paginated delivery logs
webhooksRoutes.get('/:id/deliveries', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = (page - 1) * limit;

  try {
    const accountId = getAccountId(c);
    
    // First confirm webhook belongs to account
    const [webhook] = await sql`
      SELECT id FROM webhooks WHERE id = ${id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!webhook) return c.json({ error: 'Webhook tidak ditemukan' }, 404);

    const logs = await sql`
      SELECT * FROM webhook_delivery_logs
      WHERE webhook_id = ${id}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [countResult] = await sql`
      SELECT COUNT(*)::int as total FROM webhook_delivery_logs
      WHERE webhook_id = ${id}
    `;
    const total = countResult?.total || 0;

    return c.json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetch webhook deliveries:', error);
    return c.json({ error: 'Gagal mengambil riwayat pengiriman webhook' }, 500);
  }
});
