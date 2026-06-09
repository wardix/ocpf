import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { authMiddleware, getAccountId } from '../middleware/auth';
import { clearChatbotCache } from '../chatbot/engine';

export const chatbotRoutes = new Hono();

chatbotRoutes.use('/*', authMiddleware);

const chatbotConfigSchema = z.object({
  name: z.string().min(1, 'Nama chatbot tidak boleh kosong').max(255),
  inbox_id: z.number().int().nullable().optional(),
  config: z.record(z.string(), z.any()),
  editor_metadata: z.record(z.string(), z.any()).optional()
});

const importSchema = z.object({
  name: z.string().min(1, 'Nama chatbot tidak boleh kosong').max(255),
  inbox_id: z.number().int().nullable().optional(),
  chatbot_json: z.record(z.string(), z.any())
});

const activateSchema = z.object({
  is_active: z.boolean({ message: 'is_active wajib diisi' })
});

const rollbackSchema = z.object({
  version: z.number({ message: 'version wajib diisi' }).int().positive()
});


// GET /api/chatbot/configs - List configs
chatbotRoutes.get('/configs', async (c) => {
  try {
    const accountId = getAccountId(c);
    const configs = await sql`
      SELECT c.*, i.name as inbox_name
      FROM chatbot_configs c
      LEFT JOIN inboxes i ON c.inbox_id = i.id
      WHERE c.account_id = ${accountId}
      ORDER BY c.updated_at DESC
    `;
    return c.json({ success: true, data: configs });
  } catch (error) {
    console.error('Error fetch chatbot configs:', error);
    return c.json({ error: 'Gagal mengambil daftar konfigurasi chatbot' }, 500);
  }
});

// GET /api/chatbot/configs/:id - Get details of a single config
chatbotRoutes.get('/configs/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const [config] = await sql`
      SELECT c.*, i.name as inbox_name
      FROM chatbot_configs c
      LEFT JOIN inboxes i ON c.inbox_id = i.id
      WHERE c.id = ${id} AND c.account_id = ${accountId} LIMIT 1
    `;
    if (!config) return c.json({ error: 'Konfigurasi tidak ditemukan' }, 404);
    return c.json({ success: true, data: config });
  } catch (error) {
    console.error('Error fetch chatbot config:', error);
    return c.json({ error: 'Gagal mengambil konfigurasi chatbot' }, 500);
  }
});

// POST /api/chatbot/configs - Create a new configuration and its version 1
chatbotRoutes.post('/configs', zValidator('json', chatbotConfigSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  try {
    const accountId = getAccountId(c);
    const { name, inbox_id, config, editor_metadata } = c.req.valid('json');

    const result = await sql.begin(async (tx: any) => {
      const [newConfig] = await tx`
        INSERT INTO chatbot_configs (account_id, inbox_id, name, config, editor_metadata, version)
        VALUES (${accountId}, ${inbox_id || null}, ${name}, ${config}, ${editor_metadata || {}}, 1)
        RETURNING *
      `;

      await tx`
        INSERT INTO chatbot_config_versions (chatbot_config_id, version, config, editor_metadata)
        VALUES (${newConfig.id}, 1, ${config}, ${editor_metadata || {}})
      `;

      return newConfig;
    });

    clearChatbotCache(Number(result.inbox_id));
    return c.json({ success: true, data: result }, 201);
  } catch (error) {
    console.error('Error create chatbot config:', error);
    return c.json({ error: 'Gagal membuat konfigurasi chatbot' }, 500);
  }
});

// PUT /api/chatbot/configs/:id - Update configuration and insert a new version
chatbotRoutes.put('/configs/:id', zValidator('json', chatbotConfigSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const { name, inbox_id, config, editor_metadata } = c.req.valid('json');

    const [existing] = await sql`
      SELECT id, version, inbox_id FROM chatbot_configs WHERE id = ${id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!existing) return c.json({ error: 'Konfigurasi tidak ditemukan' }, 404);

    const oldInboxId = existing.inbox_id;
    const nextVersion = Number(existing.version) + 1;

    const result = await sql.begin(async (tx: any) => {
      const [updatedConfig] = await tx`
        UPDATE chatbot_configs
        SET name = ${name},
            inbox_id = ${inbox_id || null},
            config = ${config},
            editor_metadata = ${editor_metadata || {}},
            version = ${nextVersion},
            updated_at = NOW()
        WHERE id = ${id} AND account_id = ${accountId}
        RETURNING *
      `;

      await tx`
        INSERT INTO chatbot_config_versions (chatbot_config_id, version, config, editor_metadata)
        VALUES (${id}, ${nextVersion}, ${config}, ${editor_metadata || {}})
      `;

      return updatedConfig;
    });

    clearChatbotCache(Number(oldInboxId));
    if (inbox_id) clearChatbotCache(Number(inbox_id));

    return c.json({ success: true, data: result });
  } catch (error) {
    console.error('Error update chatbot config:', error);
    return c.json({ error: 'Gagal memperbarui konfigurasi chatbot' }, 500);
  }
});

// DELETE /api/chatbot/configs/:id - Delete configuration
chatbotRoutes.delete('/configs/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const [existing] = await sql`
      SELECT inbox_id FROM chatbot_configs WHERE id = ${id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!existing) return c.json({ error: 'Konfigurasi tidak ditemukan' }, 404);

    await sql`
      DELETE FROM chatbot_configs WHERE id = ${id} AND account_id = ${accountId}
    `;

    clearChatbotCache(Number(existing.inbox_id));
    return c.json({ success: true, message: 'Konfigurasi chatbot berhasil dihapus' });
  } catch (error) {
    console.error('Error delete chatbot config:', error);
    return c.json({ error: 'Gagal menghapus konfigurasi chatbot' }, 500);
  }
});

// POST /api/chatbot/configs/:id/activate - Toggle activation status
chatbotRoutes.post('/configs/:id/activate', zValidator('json', activateSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const { is_active } = c.req.valid('json');

    const [existing] = await sql`
      SELECT id, inbox_id FROM chatbot_configs WHERE id = ${id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!existing) return c.json({ error: 'Konfigurasi tidak ditemukan' }, 404);

    const inboxId = existing.inbox_id;

    await sql.begin(async (tx: any) => {
      if (is_active && inboxId) {
        // Matikan chatbot lain untuk inbox yang sama
        await tx`
          UPDATE chatbot_configs
          SET is_active = false
          WHERE inbox_id = ${inboxId} AND account_id = ${accountId} AND id != ${id}
        `;
      }

      await tx`
        UPDATE chatbot_configs
        SET is_active = ${!!is_active}, updated_at = NOW()
        WHERE id = ${id} AND account_id = ${accountId}
      `;
    });

    clearChatbotCache(Number(inboxId));
    return c.json({ success: true, message: is_active ? 'Chatbot berhasil diaktifkan' : 'Chatbot berhasil dinonaktifkan' });
  } catch (error) {
    console.error('Error toggle activate chatbot config:', error);
    return c.json({ error: 'Gagal mengubah status aktif' }, 500);
  }
});

// GET /api/chatbot/configs/:id/versions - List versions
chatbotRoutes.get('/configs/:id/versions', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const [existing] = await sql`
      SELECT id FROM chatbot_configs WHERE id = ${id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!existing) return c.json({ error: 'Konfigurasi tidak ditemukan' }, 404);

    const versions = await sql`
      SELECT id, version, created_at
      FROM chatbot_config_versions
      WHERE chatbot_config_id = ${id}
      ORDER BY version DESC
    `;
    return c.json({ success: true, data: versions });
  } catch (error) {
    console.error('Error fetch chatbot versions:', error);
    return c.json({ error: 'Gagal mengambil versi konfigurasi' }, 500);
  }
});

// POST /api/chatbot/configs/:id/rollback - Rollback to a specific version
chatbotRoutes.post('/configs/:id/rollback', zValidator('json', rollbackSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const { version } = c.req.valid('json');

    const [existing] = await sql`
      SELECT id, inbox_id, version FROM chatbot_configs WHERE id = ${id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!existing) return c.json({ error: 'Konfigurasi tidak ditemukan' }, 404);

    const [targetVersion] = await sql`
      SELECT config, editor_metadata FROM chatbot_config_versions
      WHERE chatbot_config_id = ${id} AND version = ${version} LIMIT 1
    `;
    if (!targetVersion) return c.json({ error: 'Versi target tidak ditemukan' }, 404);

    const nextVersion = Number(existing.version) + 1;

    const result = await sql.begin(async (tx: any) => {
      const [updatedConfig] = await tx`
        UPDATE chatbot_configs
        SET config = ${targetVersion.config},
            editor_metadata = ${targetVersion.editor_metadata},
            version = ${nextVersion},
            updated_at = NOW()
        WHERE id = ${id} AND account_id = ${accountId}
        RETURNING *
      `;

      await tx`
        INSERT INTO chatbot_config_versions (chatbot_config_id, version, config, editor_metadata)
        VALUES (${id}, ${nextVersion}, ${targetVersion.config}, ${targetVersion.editor_metadata})
      `;

      return updatedConfig;
    });

    clearChatbotCache(Number(existing.inbox_id));
    return c.json({ success: true, message: `Rollback sukses ke versi ${version}`, data: result });
  } catch (error) {
    console.error('Error rollback chatbot config:', error);
    return c.json({ error: 'Gagal melakukan rollback' }, 500);
  }
});

// POST /api/chatbot/import - Import static JSON format chatbot rules
chatbotRoutes.post('/configs/import', zValidator('json', importSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  try {
    const accountId = getAccountId(c);
    const { name, inbox_id, chatbot_json } = c.req.valid('json');

    // Buat format editor metadata default jika tidak ada
    const nodes: any[] = [];
    const edges: any[] = [];
    
    // Konversi sederhana untuk visual editor
    let yPos = 50;
    if (chatbot_json.states) {
      Object.keys(chatbot_json.states).forEach((stateKey, idx) => {
        nodes.push({
          id: stateKey,
          type: 'chatbotNode',
          position: { x: 250, y: yPos },
          data: { label: stateKey, state: chatbot_json.states[stateKey] }
        });
        yPos += 150;
      });
    }

    const metadata = { nodes, edges };

    const result = await sql.begin(async (tx: any) => {
      const [newConfig] = await tx`
        INSERT INTO chatbot_configs (account_id, inbox_id, name, config, editor_metadata, version)
        VALUES (${accountId}, ${inbox_id || null}, ${name}, ${chatbot_json}, ${metadata}, 1)
        RETURNING *
      `;

      await tx`
        INSERT INTO chatbot_config_versions (chatbot_config_id, version, config, editor_metadata)
        VALUES (${newConfig.id}, 1, ${chatbot_json}, ${metadata})
      `;

      return newConfig;
    });

    clearChatbotCache(Number(result.inbox_id));
    return c.json({ success: true, data: result }, 201);
  } catch (error) {
    console.error('Error import chatbot json:', error);
    return c.json({ error: 'Gagal mengimpor JSON chatbot' }, 500);
  }
});

// GET /api/chatbot/configs/:id/export - Export config to JSON
chatbotRoutes.get('/configs/:id/export', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const [config] = await sql`
      SELECT config, name FROM chatbot_configs WHERE id = ${id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!config) return c.json({ error: 'Konfigurasi tidak ditemukan' }, 404);

    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', `attachment; filename="${config.name.replace(/\s+/g, '_')}_chatbot.json"`);
    return c.text(JSON.stringify(config.config, null, 2));
  } catch (error) {
    console.error('Error export chatbot config:', error);
    return c.json({ error: 'Gagal mengekspor chatbot' }, 500);
  }
});
