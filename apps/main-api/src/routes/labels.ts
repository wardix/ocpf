import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { authMiddleware, getAccountId } from '../middleware/auth';

export const labelsRoutes = new Hono();

labelsRoutes.use('/*', authMiddleware);

const labelSchema = z.object({
  title: z.string().min(1, 'Nama label tidak boleh kosong').max(50, 'Maksimal 50 karakter'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Format warna harus hex (contoh: #FF0000)')
});

labelsRoutes.get('/', async (c) => {
  try {
    const accountId = getAccountId(c);
    const labels = await sql`
      SELECT l.id, l.title, l.color,
        COUNT(cl.conversation_id)::int as conversations_count
      FROM labels l
      LEFT JOIN conversation_labels cl ON cl.label_id = l.id
      WHERE l.account_id = ${accountId}
      GROUP BY l.id
      ORDER BY l.title ASC
    `;
    return c.json({ success: true, data: labels });
  } catch (error) {
    console.error('Error fetch labels:', error);
    return c.json({ error: 'Gagal mengambil daftar label' }, 500);
  }
});

labelsRoutes.post('/', zValidator('json', labelSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload');
    
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const { title, color } = c.req.valid('json');

    // Cek duplikasi
    const [existing] = await sql`SELECT id FROM labels WHERE account_id = ${accountId} AND title = ${title}`;
    if (existing) return c.json({ error: 'Label dengan nama ini sudah ada' }, 400);

    const [label] = await sql`
      INSERT INTO labels (account_id, title, color)
      VALUES (${accountId}, ${title}, ${color})
      RETURNING *
    `;
    return c.json({ success: true, data: label }, 201);
  } catch (error) {
    console.error('Error create label:', error);
    return c.json({ error: 'Gagal membuat label' }, 500);
  }
});

labelsRoutes.patch('/:id', zValidator('json', labelSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload');
    
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const { title, color } = c.req.valid('json');
    
    // Cek duplikasi dengan label lain
    const [existing] = await sql`SELECT id FROM labels WHERE account_id = ${accountId} AND title = ${title} AND id != ${id}`;
    if (existing) return c.json({ error: 'Label dengan nama ini sudah ada' }, 400);

    const [label] = await sql`
      UPDATE labels
      SET title = ${title}, color = ${color}
      WHERE id = ${id} AND account_id = ${accountId}
      RETURNING *
    `;

    if (!label) return c.json({ error: 'Label tidak ditemukan' }, 404);
    return c.json({ success: true, data: label });
  } catch (error) {
    console.error('Error update label:', error);
    return c.json({ error: 'Gagal mengubah label' }, 500);
  }
});

labelsRoutes.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload');
    
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const result = await sql`DELETE FROM labels WHERE id = ${id} AND account_id = ${accountId}`;
    if (result.count === 0) return c.json({ error: 'Label tidak ditemukan' }, 404);

    return c.json({ success: true });
  } catch (error) {
    console.error('Error delete label:', error);
    return c.json({ error: 'Gagal menghapus label' }, 500);
  }
});