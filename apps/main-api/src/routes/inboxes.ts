import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { jwtMiddleware, getAccountId } from '../middleware/auth';

export const inboxesRoutes = new Hono();

inboxesRoutes.use('/*', jwtMiddleware);

const updateSettingsSchema = z.object({
  auto_assignment_enabled: z.boolean(),
  auto_assignment_algorithm: z.enum(['round_robin', 'least_busy']),
  auto_assignment_max_tickets: z.number().int().min(1).max(100),
  csat_enabled: z.boolean(),
  csat_delay_minutes: z.number().int().min(1).max(1440),
  csat_message: z.string().min(5).max(1000)
});

// GET /api/inboxes/:inbox_id/settings
inboxesRoutes.get('/:inbox_id/settings', async (c) => {
  const inboxId = parseInt(c.req.param('inbox_id'), 10);
  if (isNaN(inboxId)) return c.json({ error: 'ID inbox tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);

    // Cek apakah inbox ada dan milik account_id
    const [inbox] = await sql`
      SELECT id FROM inboxes WHERE id = ${inboxId} AND account_id = ${accountId} LIMIT 1
    `;
    if (!inbox) {
      return c.json({ error: 'Inbox tidak ditemukan' }, 404);
    }

    // Ambil setting
    let [settings] = await sql`
      SELECT * FROM inbox_settings WHERE inbox_id = ${inboxId} AND account_id = ${accountId} LIMIT 1
    `;

    // Jika belum ada, buat default
    if (!settings) {
      const defaultCsatMessage = 'Terima kasih telah menghubungi kami! Bagaimana penilaian Anda terhadap layanan kami? Reply 1-5 (1=Sangat Buruk, 5=Sangat Baik)';
      [settings] = await sql`
        INSERT INTO inbox_settings (
          inbox_id, account_id, auto_assignment_enabled, auto_assignment_algorithm, auto_assignment_max_tickets,
          csat_enabled, csat_delay_minutes, csat_message
        )
        VALUES (${inboxId}, ${accountId}, false, 'round_robin', 10, false, 5, ${defaultCsatMessage})
        RETURNING *
      `;
    }

    return c.json({ success: true, data: settings });
  } catch (error) {
    console.error('Error fetch inbox settings:', error);
    return c.json({ error: 'Gagal mengambil konfigurasi inbox' }, 500);
  }
});

// PUT /api/inboxes/:inbox_id/settings
inboxesRoutes.put('/:inbox_id/settings', zValidator('json', updateSettingsSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  const inboxId = parseInt(c.req.param('inbox_id'), 10);
  if (isNaN(inboxId)) return c.json({ error: 'ID inbox tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload') as any;

    // Proteksi role administrator
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    // Cek apakah inbox ada dan milik account_id
    const [inbox] = await sql`
      SELECT id FROM inboxes WHERE id = ${inboxId} AND account_id = ${accountId} LIMIT 1
    `;
    if (!inbox) {
      return c.json({ error: 'Inbox tidak ditemukan' }, 404);
    }

    const { 
      auto_assignment_enabled, 
      auto_assignment_algorithm, 
      auto_assignment_max_tickets,
      csat_enabled,
      csat_delay_minutes,
      csat_message
    } = c.req.valid('json');

    const [settings] = await sql`
      INSERT INTO inbox_settings (
        inbox_id, account_id, auto_assignment_enabled, auto_assignment_algorithm, auto_assignment_max_tickets,
        csat_enabled, csat_delay_minutes, csat_message, updated_at
      )
      VALUES (
        ${inboxId}, ${accountId}, ${auto_assignment_enabled}, ${auto_assignment_algorithm}, ${auto_assignment_max_tickets},
        ${csat_enabled}, ${csat_delay_minutes}, ${csat_message}, NOW()
      )
      ON CONFLICT (inbox_id)
      DO UPDATE SET 
        auto_assignment_enabled = EXCLUDED.auto_assignment_enabled,
        auto_assignment_algorithm = EXCLUDED.auto_assignment_algorithm,
        auto_assignment_max_tickets = EXCLUDED.auto_assignment_max_tickets,
        csat_enabled = EXCLUDED.csat_enabled,
        csat_delay_minutes = EXCLUDED.csat_delay_minutes,
        csat_message = EXCLUDED.csat_message,
        updated_at = NOW()
      RETURNING *
    `;

    return c.json({ success: true, data: settings });
  } catch (error) {
    console.error('Error update inbox settings:', error);
    return c.json({ error: 'Gagal memperbarui konfigurasi inbox' }, 500);
  }
});
