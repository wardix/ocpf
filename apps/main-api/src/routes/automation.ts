import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { authMiddleware, getAccountId } from '../middleware/auth';

export const automationRoutes = new Hono();

automationRoutes.use('/*', authMiddleware);

const actionSchema = z.object({
  type: z.enum(['add_label', 'assign_agent', 'send_reply', 'change_status']),
  label_id: z.number().int().optional(),
  agent_id: z.number().int().optional(),
  content: z.string().optional(),
  status: z.enum(['open', 'pending', 'resolved']).optional()
});

const triggerConfigSchema = z.object({
  keywords: z.array(z.string()).optional(),
  match_type: z.enum(['contains', 'exact', 'regex']).optional(),
  idle_minutes: z.number().int().min(1).optional(),
  from_status: z.enum(['open', 'pending', 'snoozed', 'resolved']).optional(),
  to_status: z.enum(['open', 'pending', 'snoozed', 'resolved']).optional()
});

const ruleSchema = z.object({
  name: z.string().min(1, 'Nama aturan wajib diisi'),
  description: z.string().optional(),
  trigger_type: z.enum(['message.incoming', 'ticket.idle', 'status.changed', 'contact.created']),
  trigger_config: triggerConfigSchema.optional().default({}),
  actions: z.array(actionSchema).min(1, 'Minimal harus ada 1 aksi'),
  is_active: z.boolean().optional().default(true),
  priority: z.number().int().default(0)
});

// GET / - List all rules (sorted by priority ASC)
automationRoutes.get('/', async (c) => {
  try {
    const accountId = getAccountId(c);
    const rules = await sql`
      SELECT * FROM automation_rules
      WHERE account_id = ${accountId}
      ORDER BY priority ASC, id ASC
    `;
    return c.json({ success: true, data: rules });
  } catch (err) {
    console.error('Error fetching automation rules:', err);
    return c.json({ error: 'Gagal mengambil aturan otomatisasi' }, 500);
  }
});

// POST / - Create a new rule
automationRoutes.post('/', zValidator('json', ruleSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload') as any;
    const userId = jwtPayload?.id;

    const { name, description, trigger_type, trigger_config, actions, is_active, priority } = c.req.valid('json');

    const [rule] = await sql`
      INSERT INTO automation_rules (
        account_id, name, description, trigger_type, trigger_config, actions, is_active, priority, created_by
      ) VALUES (
        ${accountId}, ${name}, ${description || ''}, ${trigger_type}, ${sql.json(trigger_config)}, ${actions.map(a => JSON.stringify(a))}::jsonb[], ${is_active}, ${priority}, ${userId}
      )
      RETURNING *
    `;
    return c.json({ success: true, data: rule });
  } catch (err) {
    console.error('Error creating automation rule:', err);
    return c.json({ error: 'Gagal membuat aturan otomatisasi' }, 500);
  }
});

// PUT /:id - Update a rule
automationRoutes.put('/:id', zValidator('json', ruleSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  try {
    const accountId = getAccountId(c);
    const ruleId = Number(c.req.param('id'));
    if (isNaN(ruleId)) return c.json({ error: 'ID tidak valid' }, 400);

    const { name, description, trigger_type, trigger_config, actions, is_active, priority } = c.req.valid('json');

    const [rule] = await sql`
      UPDATE automation_rules
      SET 
        name = ${name},
        description = ${description || ''},
        trigger_type = ${trigger_type},
        trigger_config = ${sql.json(trigger_config)},
        actions = ${actions.map(a => JSON.stringify(a))}::jsonb[],
        is_active = ${is_active},
        priority = ${priority},
        updated_at = NOW()
      WHERE id = ${ruleId} AND account_id = ${accountId}
      RETURNING *
    `;

    if (!rule) return c.json({ error: 'Aturan tidak ditemukan atau bukan milik Anda' }, 404);
    return c.json({ success: true, data: rule });
  } catch (err) {
    console.error('Error updating automation rule:', err);
    return c.json({ error: 'Gagal memperbarui aturan otomatisasi' }, 500);
  }
});

// DELETE /:id - Delete a rule
automationRoutes.delete('/:id', async (c) => {
  try {
    const accountId = getAccountId(c);
    const ruleId = Number(c.req.param('id'));
    if (isNaN(ruleId)) return c.json({ error: 'ID tidak valid' }, 400);

    const [deleted] = await sql`
      DELETE FROM automation_rules
      WHERE id = ${ruleId} AND account_id = ${accountId}
      RETURNING id
    `;

    if (!deleted) return c.json({ error: 'Aturan tidak ditemukan atau bukan milik Anda' }, 404);
    return c.json({ success: true, message: 'Aturan otomatisasi berhasil dihapus' });
  } catch (err) {
    console.error('Error deleting automation rule:', err);
    return c.json({ error: 'Gagal menghapus aturan otomatisasi' }, 500);
  }
});

// PATCH /:id/toggle - Quick activation switch
automationRoutes.patch('/:id/toggle', async (c) => {
  try {
    const accountId = getAccountId(c);
    const ruleId = Number(c.req.param('id'));
    if (isNaN(ruleId)) return c.json({ error: 'ID tidak valid' }, 400);

    const [rule] = await sql`
      UPDATE automation_rules
      SET is_active = NOT is_active, updated_at = NOW()
      WHERE id = ${ruleId} AND account_id = ${accountId}
      RETURNING id, is_active
    `;

    if (!rule) return c.json({ error: 'Aturan tidak ditemukan' }, 404);
    return c.json({ success: true, data: rule });
  } catch (err) {
    console.error('Error toggling rule:', err);
    return c.json({ error: 'Gagal mengubah status aturan otomatisasi' }, 500);
  }
});

// GET /:id/logs - Paginated execution history
automationRoutes.get('/:id/logs', async (c) => {
  try {
    const accountId = getAccountId(c);
    const ruleId = Number(c.req.param('id'));
    if (isNaN(ruleId)) return c.json({ error: 'ID tidak valid' }, 400);

    const page = Number(c.req.query('page') || '1');
    const perPage = Number(c.req.query('per_page') || '10');
    const offset = (page - 1) * perPage;

    const logs = await sql`
      SELECT * FROM automation_logs
      WHERE rule_id = ${ruleId} AND account_id = ${accountId}
      ORDER BY id DESC
      LIMIT ${perPage} OFFSET ${offset}
    `;

    const [countResult] = await sql`
      SELECT COUNT(*)::int as total FROM automation_logs
      WHERE rule_id = ${ruleId} AND account_id = ${accountId}
    `;

    return c.json({
      success: true,
      data: logs,
      meta: {
        page,
        per_page: perPage,
        total: countResult?.total || 0
      }
    });
  } catch (err) {
    console.error('Error fetching automation logs:', err);
    return c.json({ error: 'Gagal mengambil log otomatisasi' }, 500);
  }
});
