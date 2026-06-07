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

const updateBusinessHoursSchema = z.object({
  business_hours_enabled: z.boolean(),
  timezone: z.string().min(1).max(50),
  out_of_office_message: z.string().min(1).max(1000),
  schedules: z.array(z.object({
    day_of_week: z.number().int().min(0).max(6),
    open_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
    close_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
    is_closed: z.boolean()
  })).length(7)
});

// GET /api/inboxes/:inbox_id/business-hours
inboxesRoutes.get('/:inbox_id/business-hours', async (c) => {
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
      SELECT business_hours_enabled, timezone, out_of_office_message
      FROM inbox_settings
      WHERE inbox_id = ${inboxId} AND account_id = ${accountId}
      LIMIT 1
    `;

    if (!settings) {
      settings = {
        business_hours_enabled: false,
        timezone: 'Asia/Jakarta',
        out_of_office_message: 'Terima kasih telah menghubungi kami. Saat ini di luar jam operasional, kami akan merespons pada jam kerja berikutnya.'
      };
    }

    // Ambil 7 hari jam operasional
    const schedules = await sql`
      SELECT day_of_week, open_time, close_time, is_closed
      FROM business_hours
      WHERE inbox_id = ${inboxId} AND account_id = ${accountId}
      ORDER BY day_of_week ASC
    `;

    const defaultSchedules = Array.from({ length: 7 }, (_, i) => ({
      day_of_week: i,
      open_time: '08:00:00',
      close_time: '17:00:00',
      is_closed: false
    }));

    const mergedSchedules = defaultSchedules.map(def => {
      const found = schedules.find((s: any) => s.day_of_week === def.day_of_week);
      return found ? {
        day_of_week: found.day_of_week,
        open_time: found.open_time,
        close_time: found.close_time,
        is_closed: !!found.is_closed
      } : def;
    });

    const bhHelper = await import('../config/business-hours');
    const status = await bhHelper.isWithinBusinessHours(inboxId, sql);

    return c.json({
      success: true,
      data: {
        business_hours_enabled: !!settings.business_hours_enabled,
        timezone: settings.timezone || 'Asia/Jakarta',
        out_of_office_message: settings.out_of_office_message || '',
        schedules: mergedSchedules,
        is_open: status.isOpen
      }
    });
  } catch (error) {
    console.error('Error GET business-hours:', error);
    return c.json({ error: 'Gagal mengambil jam operasional' }, 500);
  }
});

// GET /api/inboxes/:inbox_id/business-hours/status
inboxesRoutes.get('/:inbox_id/business-hours/status', async (c) => {
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

    const bhHelper = await import('../config/business-hours');
    const status = await bhHelper.isWithinBusinessHours(inboxId, sql);

    return c.json({
      success: true,
      data: {
        open: status.isOpen
      }
    });
  } catch (error) {
    console.error('Error GET business-hours status:', error);
    return c.json({ error: 'Gagal mengambil status jam operasional' }, 500);
  }
});

// PUT /api/inboxes/:inbox_id/business-hours
inboxesRoutes.put('/:inbox_id/business-hours', zValidator('json', updateBusinessHoursSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  const inboxId = parseInt(c.req.param('inbox_id'), 10);
  if (isNaN(inboxId)) return c.json({ error: 'ID inbox tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload') as any;

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
      business_hours_enabled, 
      timezone, 
      out_of_office_message, 
      schedules 
    } = c.req.valid('json');

    const result = await sql.begin(async (tx) => {
      // 1. Upsert settings
      const [updatedSettings] = await tx`
        INSERT INTO inbox_settings (
          inbox_id, account_id, business_hours_enabled, timezone, out_of_office_message, updated_at
        )
        VALUES (
          ${inboxId}, ${accountId}, ${business_hours_enabled}, ${timezone}, ${out_of_office_message}, NOW()
        )
        ON CONFLICT (inbox_id)
        DO UPDATE SET 
          business_hours_enabled = EXCLUDED.business_hours_enabled,
          timezone = EXCLUDED.timezone,
          out_of_office_message = EXCLUDED.out_of_office_message,
          updated_at = NOW()
        RETURNING *
      `;

      // 2. Upsert business_hours
      const updatedSchedules = [];
      for (const day of schedules) {
        const formattedOpen = formatTime(day.open_time);
        const formattedClose = formatTime(day.close_time);
        
        const [upserted] = await tx`
          INSERT INTO business_hours (
            inbox_id, account_id, day_of_week, open_time, close_time, is_closed
          )
          VALUES (
            ${inboxId}, ${accountId}, ${day.day_of_week}, ${formattedOpen}, ${formattedClose}, ${day.is_closed}
          )
          ON CONFLICT (inbox_id, day_of_week)
          DO UPDATE SET 
            open_time = EXCLUDED.open_time,
            close_time = EXCLUDED.close_time,
            is_closed = EXCLUDED.is_closed
          RETURNING *
        `;
        updatedSchedules.push(upserted);
      }

      return { settings: updatedSettings, schedules: updatedSchedules };
    });

    return c.json({
      success: true,
      data: {
        business_hours_enabled: !!result.settings.business_hours_enabled,
        timezone: result.settings.timezone,
        out_of_office_message: result.settings.out_of_office_message,
        schedules: result.schedules.map((s: any) => ({
          day_of_week: s.day_of_week,
          open_time: s.open_time,
          close_time: s.close_time,
          is_closed: !!s.is_closed
        }))
      }
    });
  } catch (error) {
    console.error('Error PUT business-hours:', error);
    return c.json({ error: 'Gagal memperbarui jam operasional' }, 500);
  }
});

function formatTime(t: string) {
  const parts = t.split(':');
  if (parts.length === 2) {
    return `${parts[0]}:${parts[1]}:00`;
  }
  return t;
}

