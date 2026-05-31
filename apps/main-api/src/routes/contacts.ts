import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { jwtMiddleware } from '../middleware/auth';

export const contactsRoutes = new Hono();

contactsRoutes.use('/*', jwtMiddleware);

contactsRoutes.get('/', async (c) => {
  try {
    const search = c.req.query('q') || '';
    const jwtPayload = c.get('jwtPayload');
    
    const contacts = await sql`
      SELECT 
        c.id, 
        c.name, 
        c.phone_number, 
        c.email, 
        c.created_at,
        COUNT(t.id) as total_tickets
      FROM contacts c
      LEFT JOIN conversations conv ON c.id = conv.contact_id
      LEFT JOIN tickets t ON conv.id = t.conversation_id
      WHERE c.account_id = ${jwtPayload.account_id || 1} AND (c.name ILIKE ${'%' + search + '%'} OR c.phone_number ILIKE ${'%' + search + '%'})
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT 100
    `;
    
    return c.json(contacts);
  } catch (error) {
    console.error('Error fetch contacts:', error);
    return c.json({ error: 'Gagal mengambil daftar kontak' }, 500);
  }
});

const updateContactSchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi'),
  email: z.string().email('Format email tidak valid').or(z.literal('')),
});

contactsRoutes.patch('/:id', zValidator('json', updateContactSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
  }
}), async (c) => {
  const contactId = parseInt(c.req.param('id'), 10);
  if (isNaN(contactId)) {
    return c.json({ error: 'ID Kontak tidak valid' }, 400);
  }

  try {
    const jwtPayload = c.get('jwtPayload');
    const { name, email } = c.req.valid('json');

    const [updatedContact] = await sql`
      UPDATE contacts 
      SET name = ${name}, email = ${email || null}, updated_at = NOW() 
      WHERE id = ${contactId} AND account_id = ${jwtPayload.account_id || 1}
      RETURNING *;
    `;

    if (!updatedContact) {
      return c.json({ error: 'Kontak tidak ditemukan' }, 404);
    }

    return c.json({ success: true, data: updatedContact });
  } catch (error) {
    console.error('Error update contact:', error);
    return c.json({ error: 'Gagal memperbarui kontak' }, 500);
  }
});
