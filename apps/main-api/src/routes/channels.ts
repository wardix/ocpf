import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { authMiddleware, getAccountId } from '../middleware/auth';
import { redis } from '../config/redis';

export const channelsRoutes = new Hono();

channelsRoutes.use('/*', authMiddleware);

const createChannelSchema = z.object({
  name: z.string().min(1).max(255),
  provider_type: z.enum(['whatsapp', 'telegram']),
  provider_config: z.record(z.any()).default({}),
});

channelsRoutes.post('/', zValidator('json', createChannelSchema), async (c) => {
  try {
    const accountId = getAccountId(c);
    const payload = c.get('jwtPayload') as any;

    if (payload?.role !== 'administrator') {
      return c.json({ error: 'Membutuhkan akses administrator' }, 403);
    }

    const { name, provider_type, provider_config } = c.req.valid('json');

    // Telegram Token Validation
    if (provider_type === 'telegram') {
      const token = provider_config.token;
      if (!token) {
        return c.json({ error: 'Bot token wajib disertakan untuk Telegram' }, 400);
      }
      
      const res = await fetch(\`https://api.telegram.org/bot\${token}/getMe\`);
      const data = await res.json();
      if (!data.ok) {
        return c.json({ error: 'Token Telegram tidak valid' }, 400);
      }
    }

    const [newChannel] = await sql`
      INSERT INTO channels (account_id, name, provider_type, provider_config)
      VALUES (${accountId}, ${name}, ${provider_type}, ${provider_config})
      RETURNING *
    `;

    // Beritahu adapter yang relevan untuk merefresh state
    if (provider_type === 'telegram') {
      await redis.publish('system:telegram:refresh_channels', JSON.stringify({ account_id: accountId }));
    }

    return c.json({ success: true, data: newChannel }, 201);
  } catch (error: any) {
    console.error('Error creating channel:', error);
    return c.json({ error: 'Gagal membuat channel' }, 500);
  }
});

channelsRoutes.get('/', async (c) => {
  try {
    const accountId = getAccountId(c);
    const channels = await sql`
      SELECT id, name, provider_type, created_at
      FROM channels
      WHERE account_id = ${accountId}
      ORDER BY id ASC
    `;
    return c.json({ success: true, data: channels });
  } catch (error) {
    return c.json({ error: 'Gagal mengambil channels' }, 500);
  }
});
