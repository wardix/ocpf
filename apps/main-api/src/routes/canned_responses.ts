import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { jwtMiddleware } from '../middleware/auth';

export const cannedResponsesRoutes = new Hono();

cannedResponsesRoutes.use('/*', jwtMiddleware);

cannedResponsesRoutes.get('/', async (c) => {
  try {
    const responses = await sql`
      SELECT id, short_code, content 
      FROM canned_responses 
      WHERE account_id = 1 
      ORDER BY short_code ASC
    `;
    return c.json(responses);
  } catch (error) {
    console.error('Error fetch canned responses:', error);
    return c.json({ error: 'Gagal mengambil balasan cepat' }, 500);
  }
});

const cannedResponseSchema = z.object({
  short_code: z.string().min(1, 'Short code tidak boleh kosong'),
  content: z.string().min(1, 'Konten tidak boleh kosong')
});

cannedResponsesRoutes.post('/', zValidator('json', cannedResponseSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload');
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const { short_code, content } = c.req.valid('json');
    const [response] = await sql`
      INSERT INTO canned_responses (account_id, short_code, content)
      VALUES (${jwtPayload.account_id}, ${short_code}, ${content})
      RETURNING *
    `;
    return c.json({ success: true, data: response });
  } catch (error) {
    console.error('Error create canned response:', error);
    return c.json({ error: 'Gagal menambah balasan cepat' }, 500);
  }
});

cannedResponsesRoutes.put('/:id', zValidator('json', cannedResponseSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const jwtPayload = c.get('jwtPayload');
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const { short_code, content } = c.req.valid('json');
    const [response] = await sql`
      UPDATE canned_responses
      SET short_code = ${short_code}, content = ${content}
      WHERE id = ${id} AND account_id = ${jwtPayload.account_id}
      RETURNING *
    `;
    return c.json({ success: true, data: response });
  } catch (error) {
    console.error('Error update canned response:', error);
    return c.json({ error: 'Gagal mengubah balasan cepat' }, 500);
  }
});

cannedResponsesRoutes.delete('/:id', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload');
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const id = c.req.param('id');
    await sql`DELETE FROM canned_responses WHERE id = ${id} AND account_id = ${jwtPayload.account_id}`;
    return c.json({ success: true });
  } catch (error) {
    console.error('Error delete canned response:', error);
    return c.json({ error: 'Gagal menghapus balasan cepat' }, 500);
  }
});
