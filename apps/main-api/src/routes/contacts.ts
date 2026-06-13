import { Hono } from 'hono';
import postgres from 'postgres';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { authMiddleware, getAccountId } from '../middleware/auth';
import { formatTsQuery } from '../utils/search';

export const contactsRoutes = new Hono();

contactsRoutes.use('/*', authMiddleware);

// Endpoint daftar semua kontak (CRM) dengan pencarian
contactsRoutes.get('/', async (c) => {
  try {
    const search = (c.req.query('q') || '').trim();
    const accountId = getAccountId(c);
    // Pagination params
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const perPage = Math.max(1, Math.min(100, parseInt(c.req.query('per_page') || '25', 10)));
    const offset = (page - 1) * perPage;

    let contacts;
    let total = 0;

    if (search.length > 0) {
      const formattedQuery = formatTsQuery(search);
      if (formattedQuery) {
        const [totalRow] = await sql`
          SELECT COUNT(*)::int as total FROM contacts
          WHERE account_id = ${accountId} 
            AND deleted_at IS NULL 
            AND search_vector @@ to_tsquery('simple', ${formattedQuery})
        `;
        total = totalRow?.total || 0;

        contacts = await sql`
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
          WHERE c.account_id = ${accountId} 
            AND c.deleted_at IS NULL 
            AND c.search_vector @@ to_tsquery('simple', ${formattedQuery})
          GROUP BY c.id
          ORDER BY ts_rank(c.search_vector, to_tsquery('simple', ${formattedQuery})) DESC, c.created_at DESC
          LIMIT ${perPage} OFFSET ${offset}
        `;
      } else {
        contacts = [];
      }
    } else {
      const [totalRow] = await sql`
        SELECT COUNT(*)::int as total FROM contacts
        WHERE account_id = ${accountId} 
          AND deleted_at IS NULL
      `;
      total = totalRow?.total || 0;

      contacts = await sql`
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
        WHERE c.account_id = ${accountId} 
          AND c.deleted_at IS NULL 
        GROUP BY c.id
        ORDER BY c.created_at DESC
        LIMIT ${perPage} OFFSET ${offset}
      `;
    }
    
    return c.json({
      data: contacts,
      meta: {
        total,
        page,
        per_page: perPage,
        has_more: offset + contacts.length < total
      }
    });
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
    const accountId = getAccountId(c);
    const { name, email } = c.req.valid('json');

    const [updatedContact] = await sql`
      UPDATE contacts 
      SET name = ${name}, email = ${email || null}, updated_at = NOW() 
      WHERE id = ${contactId} AND account_id = ${accountId} AND deleted_at IS NULL
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

const mergeContactsSchema = z.object({
  primary_id: z.number().int().positive(),
  secondary_id: z.number().int().positive()
});

// POST /api/contacts/merge
contactsRoutes.post('/merge', zValidator('json', mergeContactsSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
  }
}), async (c) => {
  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload');
    const userId = jwtPayload?.id;

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { primary_id, secondary_id } = c.req.valid('json');

    if (primary_id === secondary_id) {
      return c.json({ error: 'ID kontak utama dan kontak sekunder tidak boleh sama' }, 400);
    }

    // Fetch both contacts to ensure they exist and belong to the same account
    const [primaryContact] = await sql`
      SELECT * FROM contacts 
      WHERE id = ${primary_id} AND account_id = ${accountId} AND deleted_at IS NULL
    `;
    const [secondaryContact] = await sql`
      SELECT * FROM contacts 
      WHERE id = ${secondary_id} AND account_id = ${accountId} AND deleted_at IS NULL
    `;

    if (!primaryContact || !secondaryContact) {
      return c.json({ error: 'Salah satu atau kedua kontak tidak ditemukan' }, 404);
    }

    await sql.begin(async (tx: postgres.Sql) => {
      // 1. Move conversations
      const resultConvs = await tx`
        UPDATE conversations 
        SET contact_id = ${primary_id} 
        WHERE contact_id = ${secondary_id} AND account_id = ${accountId}
        RETURNING id
      `;
      const conversationsMoved = resultConvs.length;

      // 2. Move contact_inboxes and resolve unique constraints
      const secondaryInboxes = await tx`
        SELECT id, inbox_id, source_id FROM contact_inboxes WHERE contact_id = ${secondary_id}
      `;
      for (const inbox of secondaryInboxes) {
        try {
          await tx`
            UPDATE contact_inboxes 
            SET contact_id = ${primary_id} 
            WHERE id = ${inbox.id}
          `;
        } catch (err) {
          const pgErr = err as { code?: string };
          if (pgErr.code === '23505') { // unique key violation
            await tx`DELETE FROM contact_inboxes WHERE id = ${inbox.id}`;
          } else {
            throw err;
          }
        }
      }

      // 3. Move csat_ratings
      await tx`
        UPDATE csat_ratings 
        SET contact_id = ${primary_id} 
        WHERE contact_id = ${secondary_id} AND account_id = ${accountId}
      `;

      // 4. Move messages (sender_id when sender_type = 'Contact')
      await tx`
        UPDATE messages 
        SET sender_id = ${primary_id} 
        WHERE sender_id = ${secondary_id} AND sender_type = 'Contact' AND account_id = ${accountId}
      `;

      // 5. Merge custom_attributes
      const primaryAttrs = primaryContact.custom_attributes || {};
      const secondaryAttrs = secondaryContact.custom_attributes || {};
      const mergedAttrs = { ...secondaryAttrs, ...primaryAttrs };

      await tx`
        UPDATE contacts 
        SET custom_attributes = ${tx.json(mergedAttrs)}, updated_at = NOW() 
        WHERE id = ${primary_id} AND account_id = ${accountId}
      `;

      // 6. Soft-delete secondary contact
      await tx`
        UPDATE contacts 
        SET deleted_at = NOW(), merged_into_id = ${primary_id}, updated_at = NOW() 
        WHERE id = ${secondary_id} AND account_id = ${accountId}
      `;

      // 7. Write log entry
      const secondaryDataJson = tx.json({
        name: secondaryContact.name,
        email: secondaryContact.email,
        phone_number: secondaryContact.phone_number,
        avatar_url: secondaryContact.avatar_url,
        custom_attributes: secondaryContact.custom_attributes
      });

      await tx`
        INSERT INTO contact_merge_logs (
          account_id, primary_contact_id, secondary_contact_id, secondary_contact_data, merged_by_user_id, conversations_moved
        ) VALUES (
          ${accountId}, ${primary_id}, ${secondary_id}, ${secondaryDataJson}, ${userId}, ${conversationsMoved}
        )
      `;
    });

    return c.json({ success: true, message: 'Kontak berhasil digabungkan' });
  } catch (error) {
    console.error('Error merge contacts:', error);
    return c.json({ error: 'Gagal menggabungkan kontak' }, 500);
  }
});

// GET /api/contacts/:id/similar
contactsRoutes.get('/:id/similar', async (c) => {
  const contactId = parseInt(c.req.param('id'), 10);
  if (isNaN(contactId)) {
    return c.json({ error: 'ID Kontak tidak valid' }, 400);
  }

  try {
    const accountId = getAccountId(c);

    const [contact] = await sql`
      SELECT id, name, phone_number FROM contacts 
      WHERE id = ${contactId} AND account_id = ${accountId} AND deleted_at IS NULL
    `;

    if (!contact) {
      return c.json({ error: 'Kontak tidak ditemukan' }, 404);
    }

    const contactName = contact.name || '';
    const contactPhone = contact.phone_number || '';
    const phoneSuffix = contactPhone ? contactPhone.slice(-8) : '';

    const similar = await sql`
      SELECT id, name, phone_number, email,
             similarity(COALESCE(name, ''), ${contactName}) as name_sim,
             similarity(COALESCE(phone_number, ''), ${contactPhone}) as phone_sim
      FROM contacts
      WHERE account_id = ${accountId}
        AND id != ${contactId}
        AND deleted_at IS NULL
        AND (
          (name IS NOT NULL AND name % ${contactName})
          OR (phone_number IS NOT NULL AND phone_number % ${contactPhone})
          OR (phone_number IS NOT NULL AND ${phoneSuffix} != '' AND phone_number ILIKE ${'%' + phoneSuffix + '%'})
        )
      ORDER BY GREATEST(similarity(COALESCE(name, ''), ${contactName}), similarity(COALESCE(phone_number, ''), ${contactPhone})) DESC
      LIMIT 5
    `;

    return c.json({ success: true, data: similar });
  } catch (error) {
    console.error('Error fetch similar contacts:', error);
    return c.json({ error: 'Gagal mencari kontak serupa' }, 500);
  }
});
