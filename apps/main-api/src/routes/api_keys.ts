import { Hono } from 'hono';
import { sql } from '../config/database';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { z } from 'zod';
import crypto from 'crypto';

export const apiKeysRoutes = new Hono();
apiKeysRoutes.use('/*', authMiddleware);

const createApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  permissions: z.array(z.string()).default([])
});

function generateApiKey(): { key: string; hash: string; prefix: string } {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const key = `omni_live_${randomBytes}`;
  const prefix = key.slice(0, 15);
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { key, hash, prefix };
}

// Create a new API Key (Requires JWT Auth or an API Key that has admin privileges, but usually we restrict it to JWT)
// Actually we'll just check if the user is administrator but we don't have role check in this simple handler yet, 
// wait, the frontend will enforce the admin only tab.
apiKeysRoutes.post('/', async (c) => {
  const accountId = c.get('account_id');
  const userId = c.get('user_id');

  if (c.get('auth_method') !== 'jwt') {
    return c.json({ error: 'API Keys can only be generated via the Dashboard' }, 403);
  }

  if (c.get('user_role') !== 'administrator') {
    return c.json({ error: 'Admin only' }, 403);
  }

  try {
    const body = await c.req.json();
    const validated = createApiKeySchema.parse(body);

    const { key, hash, prefix } = generateApiKey();

    const [apiKeyRecord] = await sql`
      INSERT INTO api_keys (
        account_id, key_hash, key_prefix, name, permissions, created_by
      ) VALUES (
        ${accountId}, ${hash}, ${prefix}, ${validated.name}, ${validated.permissions}, ${userId}
      ) RETURNING id, key_prefix, name, permissions, created_at
    `;

    return c.json({ 
      success: true, 
      data: {
        ...apiKeyRecord,
        plaintext_key: key // ONLY SHOWN ONCE
      } 
    }, 201);
  } catch (error: any) {
    return c.json({ error: error.message || 'Gagal membuat API Key' }, 400);
  }
});

// List API Keys
apiKeysRoutes.get('/', async (c) => {
  const accountId = c.get('account_id');

  try {
    const keys = await sql`
      SELECT id, key_prefix, name, permissions, last_used_at, created_at, revoked_at
      FROM api_keys
      WHERE account_id = ${accountId}
      ORDER BY created_at DESC
    `;
    
    return c.json({ success: true, data: keys });
  } catch (error: any) {
    return c.json({ error: 'Gagal memuat API Keys' }, 500);
  }
});

// Revoke API Key
apiKeysRoutes.delete('/:id', async (c) => {
  const accountId = c.get('account_id');
  const id = c.req.param('id');

  try {
    await sql`
      UPDATE api_keys 
      SET revoked_at = NOW() 
      WHERE id = ${id} AND account_id = ${accountId}
    `;
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: 'Gagal mencabut API Key' }, 500);
  }
});
