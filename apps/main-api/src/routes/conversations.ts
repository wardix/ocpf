import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { redis, PUB_SUB_CH } from '../config/redis';
import { jwtMiddleware } from '../middleware/auth';

export const conversationsRoutes = new Hono();

conversationsRoutes.use('/*', jwtMiddleware);

conversationsRoutes.get('/', async (c) => {
  try {
    const activeTab = c.req.query('tab') || 'unassigned';
    const jwtPayload = c.get('jwtPayload') as any;
    const currentAgentId = jwtPayload?.id;
    const accountId = jwtPayload?.account_id || 1;

    // Pagination params
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const perPage = Math.max(1, Math.min(100, parseInt(c.req.query('per_page') || '25', 10)));
    const offset = (page - 1) * perPage;

    // Menghitung total data untuk tab ini
    const [totalRow] = await sql`
      WITH FilteredConvs AS (
        SELECT 
          c.id, t.status, t.assignee_id
        FROM conversations c
        LEFT JOIN tickets t ON t.conversation_id = c.id AND t.status != 'resolved'
        WHERE c.account_id = ${accountId}
      )
      SELECT COUNT(*) as total FROM FilteredConvs
      WHERE 
          (${activeTab === 'unassigned'}::boolean = true AND status IS NOT NULL AND assignee_id IS NULL) OR
          (${activeTab === 'mine'}::boolean = true AND status IS NOT NULL AND assignee_id = ${currentAgentId}) OR
          (${activeTab === 'assigned'}::boolean = true AND status IS NOT NULL AND assignee_id IS NOT NULL) OR
          (${activeTab === 'all'}::boolean = true)
    `;

    const total = parseInt(totalRow?.total || '0', 10);

    const convs = await sql`
      WITH ActiveConversations AS (
        SELECT 
          c.id,
          c.id as conversation_id,
          t.id as ticket_id, 
          t.status, 
          t.assignee_id,
          u.name as assignee_name,
          con.id as contact_id,
          con.name as contact_name, 
          con.email as contact_email,
          con.phone_number as contact_phone,
          (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
          COALESCE((SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1), c.updated_at) as updated_at
        FROM conversations c
        JOIN contacts con ON c.contact_id = con.id
        LEFT JOIN tickets t ON t.conversation_id = c.id AND t.status != 'resolved'
        LEFT JOIN users u ON t.assignee_id = u.id
        WHERE c.account_id = ${accountId} 
      )
      SELECT * FROM ActiveConversations
      WHERE 
          (${activeTab === 'unassigned'}::boolean = true AND status IS NOT NULL AND assignee_id IS NULL) OR
          (${activeTab === 'mine'}::boolean = true AND status IS NOT NULL AND assignee_id = ${currentAgentId}) OR
          (${activeTab === 'assigned'}::boolean = true AND status IS NOT NULL AND assignee_id IS NOT NULL) OR
          (${activeTab === 'all'}::boolean = true)
      ORDER BY updated_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `;

    return c.json({
      data: convs,
      meta: {
        total,
        page,
        per_page: perPage,
        has_more: offset + convs.length < total
      }
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Gagal mengambil daftar percakapan' }, 500);
  }
});

conversationsRoutes.get('/info/:id', async (c) => {
  const ticketId = c.req.param('id');
  try {
    const jwtPayload = c.get('jwtPayload');
    const [ticketInfo] = await sql`
      SELECT 
        t.id, 
        t.status, 
        t.assignee_id,
        u.name as assignee_name,
        con.id as contact_id,
        con.name as contact_name, 
        con.email as contact_email,
        con.phone_number as contact_phone
      FROM tickets t
      JOIN conversations conv ON t.conversation_id = conv.id
      JOIN contacts con ON conv.contact_id = con.id
      LEFT JOIN users u ON t.assignee_id = u.id
      WHERE t.id = ${ticketId} AND t.account_id = ${jwtPayload.account_id}
      LIMIT 1
    `;
    
    if (!ticketInfo) return c.json({ error: 'Tiket tidak ditemukan' }, 404);
    return c.json(ticketInfo);
  } catch (error) {
    console.error('Error fetch ticket info:', error);
    return c.json({ error: 'Gagal mengambil info tiket' }, 500);
  }
});

conversationsRoutes.get('/by-phone/:phone', async (c) => {
  const phone = c.req.param('phone');
  try {
    const jwtPayload = c.get('jwtPayload');
    const [ticketInfo] = await sql`
      SELECT 
        t.id, 
        t.status, 
        t.assignee_id,
        u.name as assignee_name,
        con.id as contact_id,
        con.name as contact_name, 
        con.email as contact_email,
        con.phone_number as contact_phone
      FROM tickets t
      JOIN conversations conv ON t.conversation_id = conv.id
      JOIN contacts con ON conv.contact_id = con.id
      LEFT JOIN users u ON t.assignee_id = u.id
      WHERE con.phone_number = ${phone} AND t.account_id = ${jwtPayload.account_id}
      ORDER BY t.updated_at DESC
      LIMIT 1
    `;
    
    if (!ticketInfo) return c.json({ error: 'Kontak atau percakapan tidak ditemukan' }, 404);
    return c.json(ticketInfo);
  } catch (error) {
    console.error('Error fetch by phone:', error);
    return c.json({ error: 'Gagal mencari percakapan' }, 500);
  }
});

conversationsRoutes.get('/:id/messages', async (c) => {
  const conversationId = c.req.param('id');
  const beforeId = c.req.query('before'); 
  const timeTravelTicketId = c.req.query('ticket_id');
  try {
    let maxMessageId = 999999999; 
    
    if (timeTravelTicketId) {
      const [ticketMax] = await sql`SELECT MAX(id) as max_id FROM messages WHERE ticket_id = ${timeTravelTicketId}`;
      if (ticketMax?.max_id) maxMessageId = ticketMax.max_id;
    }

    const messages = await sql`
      SELECT 
        m.*,
        COALESCE(
          json_agg(a.*) FILTER (WHERE a.id IS NOT NULL), 
          '[]'
        ) AS attachments
      FROM messages m
      LEFT JOIN attachments a ON m.id = a.message_id
      WHERE m.conversation_id = ${conversationId} 
      AND m.id <= ${maxMessageId}
      AND (${beforeId ? Number(beforeId) : null}::int IS NULL OR m.id < ${beforeId ? Number(beforeId) : null})
      GROUP BY m.id
      ORDER BY m.id DESC
      LIMIT 50
    `;
    
    return c.json(messages.reverse());
  } catch (error) {
    return c.json({ error: 'Gagal mengambil pesan' }, 500);
  }
});

const startConversationSchema = z.object({
  phone_number: z.string().min(5, 'Nomor telepon tidak valid'),
  name: z.string().optional()
});

conversationsRoutes.post('/start', zValidator('json', startConversationSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
  }
}), async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload');
    const { phone_number, name } = c.req.valid('json');

    let cleanPhone = phone_number.replace(/[^\d-]/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.substring(1);
    
    // Deteksi grup WA: Jika ada tanda hubung, atau panjangnya lebih dari 15 digit
    const isGroup = cleanPhone.includes('-') || cleanPhone.length > 15;
    const sourceJid = cleanPhone + (isGroup ? '@g.us' : '@s.whatsapp.net');

    const ACCOUNT_ID = getAccountId(c);
    const INBOX_ID = parseInt(process.env.INBOX_ID || '1'); 

    let [contact] = await sql`SELECT id, name, email FROM contacts WHERE phone_number = ${sourceJid} AND account_id = ${ACCOUNT_ID} LIMIT 1`;
    if (!contact) {
      [contact] = await sql`
        INSERT INTO contacts (account_id, name, phone_number)
        VALUES (${ACCOUNT_ID}, ${name || cleanPhone}, ${sourceJid})
        RETURNING id, name, email;
      `;
    }

    let [conversation] = await sql`
      SELECT id FROM conversations
      WHERE account_id = ${ACCOUNT_ID} AND inbox_id = ${INBOX_ID} AND contact_id = ${contact.id}
      LIMIT 1
    `;
    if (!conversation) {
      [conversation] = await sql`
        INSERT INTO conversations (account_id, inbox_id, contact_id)
        VALUES (${ACCOUNT_ID}, ${INBOX_ID}, ${contact.id})
        RETURNING id;
      `;
    }

    const [ticket] = await sql`
      SELECT t.id, t.status, t.assignee_id, u.name as assignee_name 
      FROM tickets t 
      LEFT JOIN users u ON t.assignee_id = u.id
      WHERE t.conversation_id = ${conversation.id} AND t.status != 'resolved'
      LIMIT 1
    `;

    return c.json({
      success: true,
      data: {
        id: conversation.id,
        contact_id: contact.id,
        contact_name: contact.name,
        contact_email: contact.email,
        contact_phone: sourceJid,
        ticket_id: ticket?.id || null,
        status: ticket?.status || null,
        assignee_id: ticket?.assignee_id || null,
        assignee_name: ticket?.assignee_name || null
      }
    });
  } catch (error) {
    console.error('Error start conversation:', error);
    return c.json({ error: 'Gagal memulai percakapan' }, 500);
  }
});

const updateStatusSchema = z.object({
  status: z.enum(['open', 'pending', 'snoozed', 'resolved'])
});

conversationsRoutes.patch('/:id/status', zValidator('json', updateStatusSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  const conversationId = parseInt(c.req.param('id'), 10);
  if (isNaN(conversationId)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const jwtPayload = c.get('jwtPayload');
    const agentId = jwtPayload.id;
    const agentName = jwtPayload.name;
    const { status } = c.req.valid('json');

    const [ticket] = await sql`
      UPDATE tickets 
      SET status = ${status}, updated_at = NOW() 
      WHERE conversation_id = ${conversationId} AND status != 'resolved'
      RETURNING *;
    `;

    if (!ticket) {
      return c.json({ error: 'Tiket tidak ditemukan' }, 404);
    }

    await sql`
      INSERT INTO conversation_events (account_id, conversation_id, ticket_id, actor_type, actor_id, event_type, event_data)
      VALUES (${ticket.account_id}, ${ticket.conversation_id}, ${ticket.id}, 'User', ${agentId}, 'status_changed', ${sql.json({ new_status: status })});
    `;
    
    let systemText = `Tiket diubah menjadi ${status}`;
    if (status === 'resolved') systemText = `Tiket #TKT-${String(ticket.id).padStart(4, '0')} ditutup oleh Agen ${agentName}`;
    
    const [sysMsg] = await sql`
      INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, sender_id, content, message_type, status)
      VALUES (${ticket.account_id}, ${ticket.conversation_id}, ${ticket.id}, 'System', NULL, ${systemText}, 'template', 'sent')
      RETURNING *;
    `;
    await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: sysMsg }));

    return c.json({ success: true, data: ticket });
  } catch (error) {
    console.error('Error update status:', error);
    return c.json({ success: false, error: 'Gagal update status' }, 500);
  }
});

conversationsRoutes.patch('/:id/assign', async (c) => {
  const conversationId = parseInt(c.req.param('id'), 10);
  if (isNaN(conversationId)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const jwtPayload = c.get('jwtPayload');
    const agentId = jwtPayload.id;
    const agentName = jwtPayload.name;

    const ticket = await sql.begin(async (tx) => {
      const [updatedTicket] = await tx`
        UPDATE tickets 
        SET assignee_id = ${agentId}, updated_at = NOW() 
        WHERE conversation_id = ${conversationId} AND status != 'resolved' AND assignee_id IS NULL
        RETURNING *;
      `;

      if (!updatedTicket) {
        const [existing] = await tx`SELECT assignee_id FROM tickets WHERE conversation_id = ${conversationId} AND status != 'resolved'`;
        if (!existing) throw new Error('NOT_FOUND');
        if (existing.assignee_id !== null) throw new Error('ALREADY_ASSIGNED');
      }

      await tx`
        INSERT INTO conversation_events (account_id, conversation_id, ticket_id, actor_type, actor_id, event_type, event_data)
        VALUES (${updatedTicket.account_id}, ${updatedTicket.conversation_id}, ${updatedTicket.id}, 'User', ${agentId}, 'assigned', ${sql.json({ new_assignee_id: agentId })});
      `;
      
      const [sysMsg] = await tx`
        INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, sender_id, content, message_type, status)
        VALUES (${updatedTicket.account_id}, ${updatedTicket.conversation_id}, ${updatedTicket.id}, 'System', NULL, ${`Tiket #TKT-${String(updatedTicket.id).padStart(4, '0')} diambil alih oleh ${agentName}`}, 'template', 'sent')
        RETURNING *;
      `;
      await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: sysMsg }));

      return updatedTicket;
    });

    return c.json({ success: true, data: ticket });
  } catch (error: any) {
    console.error('Error assign ticket:', error);
    if (error.message === 'NOT_FOUND') return c.json({ error: 'Tiket tidak ditemukan' }, 404);
    if (error.message === 'ALREADY_ASSIGNED') return c.json({ error: 'Tiket sudah diambil agen lain' }, 400);
    return c.json({ success: false, error: 'Gagal mengambil tiket' }, 500);
  }
});

conversationsRoutes.patch('/:id/unassign', async (c) => {
  const conversationId = parseInt(c.req.param('id'), 10);
  if (isNaN(conversationId)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const jwtPayload = c.get('jwtPayload');
    const agentId = jwtPayload.id;
    const agentName = jwtPayload.name;

    const ticket = await sql.begin(async (tx) => {
      const [updatedTicket] = await tx`
        UPDATE tickets 
        SET assignee_id = NULL, updated_at = NOW() 
        WHERE conversation_id = ${conversationId} AND status != 'resolved' AND assignee_id = ${agentId}
        RETURNING *;
      `;

      if (!updatedTicket) {
        throw new Error('NOT_FOUND_OR_NOT_OWNED');
      }

      await tx`
        INSERT INTO conversation_events (account_id, conversation_id, ticket_id, actor_type, actor_id, event_type, event_data)
        VALUES (${updatedTicket.account_id}, ${updatedTicket.conversation_id}, ${updatedTicket.id}, 'User', ${agentId}, 'unassigned', ${sql.json({ old_assignee_id: agentId })});
      `;
      
      const [sysMsg] = await tx`
        INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, sender_id, content, message_type, status)
        VALUES (${updatedTicket.account_id}, ${updatedTicket.conversation_id}, ${updatedTicket.id}, 'System', NULL, ${`Tiket #TKT-${String(updatedTicket.id).padStart(4, '0')} dilepas oleh ${agentName}`}, 'template', 'sent')
        RETURNING *;
      `;
      await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: sysMsg }));

      return updatedTicket;
    });

    return c.json({ success: true, data: ticket });
  } catch (error: any) {
    console.error('Error unassign ticket:', error);
    if (error.message === 'NOT_FOUND_OR_NOT_OWNED') return c.json({ error: 'Tiket tidak ditemukan atau tidak dipegang oleh Anda' }, 400);
    return c.json({ success: false, error: 'Gagal melepas tiket' }, 500);
  }
});
