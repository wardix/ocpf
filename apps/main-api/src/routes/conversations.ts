import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { redis, PUB_SUB_CH } from '../config/redis';
import { authMiddleware, getAccountId } from '../middleware/auth';
import { dispatchWebhook } from '../utils/webhooks';
import { evaluateAutomationRules } from '../utils/automation';

export const conversationsRoutes = new Hono();

conversationsRoutes.use('/*', authMiddleware);

conversationsRoutes.get('/', async (c) => {
  try {
    const activeTab = c.req.query('tab') || 'unassigned';
    const inboxIdQuery = c.req.query('inbox_id');
    const inboxId = inboxIdQuery ? parseInt(inboxIdQuery, 10) : null;
    
    const jwtPayload = c.get('jwtPayload') as any;
    const currentAgentId = jwtPayload?.id;
    const accountId = jwtPayload?.account_id || 1;

    // Pagination params
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const perPage = Math.max(1, Math.min(100, parseInt(c.req.query('per_page') || '25', 10)));
    const offset = (page - 1) * perPage;

    const isInboxFilter = inboxId !== null && !isNaN(inboxId);
    const isAgent = jwtPayload?.role !== 'administrator';

    // Menghitung total data untuk tab ini
    const [totalRow] = await sql`
      WITH FilteredConvs AS (
        SELECT 
          c.id, t.status, t.assignee_id, t.team_id
        FROM conversations c
        LEFT JOIN tickets t ON t.conversation_id = c.id AND t.status != 'resolved'
        WHERE c.account_id = ${accountId}
          ${isInboxFilter ? sql`AND c.inbox_id = ${inboxId}` : (isAgent ? sql`AND c.inbox_id IN (SELECT inbox_id FROM inbox_members WHERE user_id = ${currentAgentId})` : sql``)}
      )
      SELECT COUNT(*) as total FROM FilteredConvs
      WHERE 
          (${activeTab === 'unassigned'}::boolean = true AND status IS NOT NULL AND assignee_id IS NULL) OR
          (${activeTab === 'mine'}::boolean = true AND status IS NOT NULL AND assignee_id = ${currentAgentId}) OR
          (${activeTab === 'assigned'}::boolean = true AND status IS NOT NULL AND assignee_id IS NOT NULL) OR
          (${activeTab === 'my_teams'}::boolean = true AND status IS NOT NULL AND team_id IN (SELECT team_id FROM team_members WHERE user_id = ${currentAgentId})) OR
          (${activeTab === 'all'}::boolean = true)
    `;

    const total = parseInt(totalRow?.total || '0', 10);

    const convs = await sql`
      WITH ActiveConversations AS (
        SELECT 
          c.id,
          c.id as conversation_id,
          c.inbox_id,
          i.name as inbox_name,
          t.id as ticket_id, 
          t.status, 
          t.assignee_id,
          t.team_id,
          t.snoozed_until,
          u.name as assignee_name,
          tm.name as team_name,
          con.id as contact_id,
          con.name as contact_name, 
          con.email as contact_email,
          con.phone_number as contact_phone,
          ch.provider_type,
          (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
          COALESCE((SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1), c.updated_at) as updated_at,
          COALESCE(
            (SELECT json_agg(json_build_object('id', l.id, 'title', l.title, 'color', l.color)) 
             FROM conversation_labels cl 
             JOIN labels l ON cl.label_id = l.id 
             WHERE cl.conversation_id = c.id), 
            '[]'::json
          ) as labels
        FROM conversations c
        JOIN contacts con ON c.contact_id = con.id
        JOIN inboxes i ON c.inbox_id = i.id
        JOIN channels ch ON i.channel_id = ch.id
        LEFT JOIN tickets t ON t.conversation_id = c.id AND t.status != 'resolved'
        LEFT JOIN users u ON t.assignee_id = u.id
        LEFT JOIN teams tm ON t.team_id = tm.id
        WHERE c.account_id = ${accountId} AND con.deleted_at IS NULL
          ${isInboxFilter ? sql`AND c.inbox_id = ${inboxId}` : (isAgent ? sql`AND c.inbox_id IN (SELECT inbox_id FROM inbox_members WHERE user_id = ${currentAgentId})` : sql``)}
      )
      SELECT * FROM ActiveConversations
      WHERE 
          (${activeTab === 'unassigned'}::boolean = true AND status IS NOT NULL AND assignee_id IS NULL) OR
          (${activeTab === 'mine'}::boolean = true AND status IS NOT NULL AND assignee_id = ${currentAgentId}) OR
          (${activeTab === 'assigned'}::boolean = true AND status IS NOT NULL AND assignee_id IS NOT NULL) OR
          (${activeTab === 'my_teams'}::boolean = true AND status IS NOT NULL AND team_id IN (SELECT team_id FROM team_members WHERE user_id = ${currentAgentId})) OR
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
      WHERE t.id = ${ticketId} AND t.account_id = ${jwtPayload.account_id} AND con.deleted_at IS NULL
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
      WHERE con.phone_number = ${phone} AND t.account_id = ${jwtPayload.account_id} AND con.deleted_at IS NULL
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
        ) AS attachments,
        (
          SELECT json_build_object(
            'subject', em.subject,
            'cc_addresses', em.cc_addresses,
            'bcc_addresses', em.bcc_addresses,
            'html_content', em.html_content,
            'has_attachments', em.has_attachments
          ) FROM email_message_metadata em WHERE em.message_id = m.id
        ) as email_metadata
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

conversationsRoutes.get('/:id/viewers', async (c) => {
  const conversationId = c.req.param('id');
  try {
    const { redis } = await import('../config/redis');
    const setKey = `viewers:${conversationId}`;
    const userIds = await redis.smembers(setKey);
    const activeViewers = [];

    for (const uid of userIds) {
      const uName = await redis.get(`viewing:${conversationId}:${uid}`);
      if (uName) {
        activeViewers.push({ id: Number(uid), name: uName });
      } else {
        await redis.srem(setKey, uid);
      }
    }
    return c.json({ success: true, data: activeViewers });
  } catch (error) {
    return c.json({ success: false, error: 'Gagal memuat viewers' }, 500);
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

    let [contact] = await sql`
      SELECT id, name, email, deleted_at, merged_into_id FROM contacts 
      WHERE phone_number = ${sourceJid} AND account_id = ${ACCOUNT_ID} 
      LIMIT 1
    `;
    if (contact) {
      if (contact.deleted_at) {
        if (contact.merged_into_id) {
          const [primaryContact] = await sql`
            SELECT id, name, email FROM contacts WHERE id = ${contact.merged_into_id} AND deleted_at IS NULL LIMIT 1
          `;
          contact = primaryContact || null;
        } else {
          contact = null;
        }
      }
    }

    let isNewContact = false;
    if (!contact) {
      isNewContact = true;
      [contact] = await sql`
        INSERT INTO contacts (account_id, name, phone_number)
        VALUES (${ACCOUNT_ID}, ${name || cleanPhone}, ${sourceJid})
        RETURNING id, name, email;
      `;
    }

    let isNewConversation = false;
    let [conversation] = await sql`
      SELECT id FROM conversations
      WHERE account_id = ${ACCOUNT_ID} AND inbox_id = ${INBOX_ID} AND contact_id = ${contact.id}
      LIMIT 1
    `;
    if (!conversation) {
      isNewConversation = true;
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

    if (isNewContact) {
      dispatchWebhook(ACCOUNT_ID, 'contact.created', contact).catch(e => console.error(e));
    }
    if (isNewConversation) {
      dispatchWebhook(ACCOUNT_ID, 'conversation.created', {
        id: Number(conversation.id),
        account_id: ACCOUNT_ID,
        inbox_id: INBOX_ID,
        contact_id: Number(contact.id)
      }).catch(e => console.error(e));
    }

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

    const [currentTicket] = await sql`
      SELECT status, account_id FROM tickets WHERE conversation_id = ${conversationId} AND status != 'resolved' LIMIT 1
    `;

    const [ticket] = await sql`
      UPDATE tickets 
      SET 
        status = ${status}, 
        updated_at = NOW(),
        resolved_at = CASE WHEN ${status} = 'resolved'::conversation_status THEN NOW() ELSE resolved_at END
      WHERE conversation_id = ${conversationId} AND status != 'resolved'
      RETURNING *;
    `;

    if (ticket && currentTicket && currentTicket.status !== status) {
      evaluateAutomationRules(Number(currentTicket.account_id), 'status.changed', {
        conversationId,
        ticketId: ticket.id,
        previousStatus: currentTicket.status,
        newStatus: status
      }).catch(err => console.error('[Automation Engine] Error executing status.changed rules:', err));
    }

    if (ticket && status === 'resolved') {
      try {
        const [inboxInfo] = await sql`
          SELECT inbox_id, account_id FROM conversations WHERE id = ${ticket.conversation_id} LIMIT 1
        `;
        if (inboxInfo) {
          const [settings] = await sql`
            SELECT csat_enabled, csat_delay_minutes 
            FROM inbox_settings 
            WHERE inbox_id = ${inboxInfo.inbox_id} AND account_id = ${inboxInfo.account_id} 
            LIMIT 1
          `;
          if (settings && settings.csat_enabled) {
            const delayMinutes = Number(settings.csat_delay_minutes) || 5;
            const executionTime = Math.floor(Date.now() / 1000) + (delayMinutes * 60);
            
            const payload = {
              ticket_id: Number(ticket.id),
              inbox_id: Number(inboxInfo.inbox_id),
              account_id: Number(inboxInfo.account_id),
              conversation_id: Number(ticket.conversation_id)
            };
            
            await redis.zadd('queue:csat_surveys', executionTime, JSON.stringify(payload));
            console.log(`[CSAT] Menjadwalkan survei untuk tiket #${ticket.id} pada timestamp ${executionTime}`);
          }
        }
      } catch (csatErr) {
        console.error('Gagal menjadwalkan CSAT survey:', csatErr);
      }

      dispatchWebhook(Number(ticket.account_id), 'conversation.resolved', {
        conversation_id: Number(ticket.conversation_id),
        ticket_id: Number(ticket.id),
        status: 'resolved',
        resolved_at: new Date().toISOString()
      }).catch(e => console.error(e));
    }

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

const assignTicketSchema = z.object({
  assignee_id: z.number().int().optional().nullable(),
  team_id: z.number().int().optional().nullable()
});

conversationsRoutes.patch('/:id/assign', zValidator('json', assignTicketSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  const conversationId = parseInt(c.req.param('id'), 10);
  if (isNaN(conversationId)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const jwtPayload = c.get('jwtPayload') as any;
    const actorId = jwtPayload.id;
    const actorName = jwtPayload.name;
    const { assignee_id: targetAgentId, team_id: targetTeamId } = c.req.valid('json');

    // Jika assignee_id diberikan, hanya admin yang boleh
    if (targetAgentId !== undefined && targetAgentId !== actorId && targetAgentId !== null) {
      if (jwtPayload.role !== 'administrator') {
        return c.json({ error: 'Hanya administrator yang boleh memindahkan tiket ke agen lain' }, 403);
      }
    }

    const assigneeId = targetAgentId !== undefined ? targetAgentId : actorId;

    const ticket = await sql.begin(async (tx) => {
      let updatedTicket;
      
      if (targetTeamId !== undefined) {
         // Team assignment overrides self-assign logic
         [updatedTicket] = await tx`
           UPDATE tickets 
           SET 
             team_id = ${targetTeamId},
             assignee_id = ${targetAgentId !== undefined ? targetAgentId : null},
             updated_at = NOW() 
           WHERE conversation_id = ${conversationId} AND status != 'resolved'
           RETURNING *;
         `;
      } else if (targetAgentId) {
        // Admin reassign - override existing assignment
        [updatedTicket] = await tx`
          UPDATE tickets 
          SET assignee_id = ${assigneeId}, updated_at = NOW() 
          WHERE conversation_id = ${conversationId} AND status != 'resolved'
          RETURNING *;
        `;
      } else {
        // Self-assign - hanya jika belum diambil orang lain
        [updatedTicket] = await tx`
          UPDATE tickets 
          SET assignee_id = ${assigneeId}, updated_at = NOW() 
          WHERE conversation_id = ${conversationId} AND status != 'resolved' AND assignee_id IS NULL
          RETURNING *;
        `;
      }

      if (!updatedTicket) {
        throw new Error(targetAgentId ? 'NOT_FOUND' : 'ALREADY_ASSIGNED');
      }

      // Cari nama target agent
      const [targetAgent] = await tx`SELECT name FROM users WHERE id = ${assigneeId}`;
      const targetName = targetAgent?.name || 'Unknown';

      let systemText = '';
      if (targetTeamId !== undefined && targetTeamId !== null) {
        const [targetTeam] = await tx`SELECT name FROM teams WHERE id = ${targetTeamId}`;
        const teamName = targetTeam?.name || 'Unknown Team';
        systemText = `Tiket #TKT-${String(updatedTicket.id).padStart(4, '0')} di-assign ke tim ${teamName} oleh ${actorName}`;
        if (targetAgentId) systemText += ` (Agen: ${targetName})`;
      } else {
        systemText = targetAgentId
          ? `Tiket #TKT-${String(updatedTicket.id).padStart(4, '0')} di-assign ke ${targetName} oleh ${actorName}`
          : `Tiket #TKT-${String(updatedTicket.id).padStart(4, '0')} diambil alih oleh ${actorName}`;
      }

      await tx`
        INSERT INTO conversation_events (account_id, conversation_id, ticket_id, actor_type, actor_id, event_type, event_data)
        VALUES (${updatedTicket.account_id}, ${updatedTicket.conversation_id}, ${updatedTicket.id}, 'User', ${actorId}, 'assigned', ${sql.json({ new_assignee_id: assigneeId, new_team_id: targetTeamId, reassigned_by: targetAgentId ? actorId : null })});
      `;
      
      const [sysMsg] = await tx`
        INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, sender_id, content, message_type, status)
        VALUES (${updatedTicket.account_id}, ${updatedTicket.conversation_id}, ${updatedTicket.id}, 'System', NULL, ${systemText}, 'template', 'sent')
        RETURNING *;
      `;
      await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: sysMsg }));

      return updatedTicket;
    });

    return c.json({ success: true, data: ticket });
  } catch (error: any) {
    console.error('Error assign ticket:', error);
    if (error.message === 'NOT_FOUND') return c.json({ error: 'Tiket tidak ditemukan' }, 404);
    if (error.message === 'ALREADY_ASSIGNED') {
      // Return custom message untuk self-assign jika sudah diambil
      return c.json({ error: 'Tiket sudah diambil agen lain' }, 400);
    }
    return c.json({ success: false, error: 'Gagal melakukan assignment tiket' }, 500);
  }
});

const snoozeSchema = z.object({
  snoozed_until: z.string().datetime({ message: 'Format timestamp tidak valid (ISO 8601)' })
});

conversationsRoutes.patch('/:id/snooze', zValidator('json', snoozeSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  const conversationId = parseInt(c.req.param('id'), 10);
  if (isNaN(conversationId)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const jwtPayload = c.get('jwtPayload') as any;
    const { snoozed_until } = c.req.valid('json');

    if (new Date(snoozed_until) <= new Date()) {
      return c.json({ error: 'Waktu snooze harus di masa depan' }, 400);
    }

    const ticket = await sql.begin(async (tx) => {
      const [currentTicket] = await tx`
        SELECT status FROM tickets WHERE conversation_id = ${conversationId} AND status != 'resolved' LIMIT 1
      `;

      const [updatedTicket] = await tx`
        UPDATE tickets
        SET status = 'snoozed', snoozed_until = ${snoozed_until}, updated_at = NOW()
        WHERE conversation_id = ${conversationId} AND status != 'resolved'
        RETURNING *
      `;

      if (!updatedTicket) throw new Error('NOT_FOUND');

      if (currentTicket && currentTicket.status !== 'snoozed') {
        evaluateAutomationRules(Number(updatedTicket.account_id), 'status.changed', {
          conversationId,
          ticketId: updatedTicket.id,
          previousStatus: currentTicket.status,
          newStatus: 'snoozed'
        }).catch(err => console.error('[Automation Engine] Error executing status.changed rules:', err));
      }

      await tx`
        INSERT INTO conversation_events (account_id, conversation_id, ticket_id, actor_type, actor_id, event_type, event_data)
        VALUES (${updatedTicket.account_id}, ${conversationId}, ${updatedTicket.id}, 'User', ${jwtPayload.id}, 'snoozed', ${sql.json({ snoozed_until })})
      `;

      const [sysMsg] = await tx`
        INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, sender_id, content, message_type, status)
        VALUES (${updatedTicket.account_id}, ${conversationId}, ${updatedTicket.id}, 'System', NULL,
          ${`Tiket di-snooze sampai ${new Date(snoozed_until).toLocaleString('id-ID')}`},
          'template', 'sent')
        RETURNING *
      `;
      await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: sysMsg }));
      
      // Update global conversation list real-time via pubsub
      await redis.publish(PUB_SUB_CH, JSON.stringify({ 
        event: 'conversation.updated', 
        data: { 
          id: conversationId, 
          account_id: updatedTicket.account_id,
          status: 'snoozed',
          snoozed_until: snoozed_until
        } 
      }));

      return updatedTicket;
    });

    return c.json({ success: true, data: ticket });
  } catch (error: any) {
    console.error('Error snooze ticket:', error);
    if (error.message === 'NOT_FOUND') return c.json({ error: 'Tiket tidak ditemukan atau sudah ditutup' }, 404);
    return c.json({ success: false, error: 'Gagal snooze tiket' }, 500);
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

// GET /api/conversations/:id/labels
conversationsRoutes.get('/:id/labels', async (c) => {
  const conversationId = parseInt(c.req.param('id'), 10);
  if (isNaN(conversationId)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const labels = await sql`
      SELECT l.id, l.title, l.color
      FROM conversation_labels cl
      JOIN labels l ON l.id = cl.label_id
      WHERE cl.conversation_id = ${conversationId}
    `;
    return c.json({ success: true, data: labels });
  } catch (error) {
    console.error('Error fetch conversation labels:', error);
    return c.json({ error: 'Gagal mengambil label' }, 500);
  }
});

const assignLabelSchema = z.object({
  label_id: z.number().int()
});

// POST /api/conversations/:id/labels
conversationsRoutes.post('/:id/labels', zValidator('json', assignLabelSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  const conversationId = parseInt(c.req.param('id'), 10);
  if (isNaN(conversationId)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    const { label_id } = c.req.valid('json');

    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO conversation_labels (conversation_id, label_id)
        VALUES (${conversationId}, ${label_id})
        ON CONFLICT DO NOTHING
      `;
      
      // Auto-routing check
      const [routing] = await tx`
        SELECT team_id FROM label_team_routing
        WHERE label_id = ${label_id} AND account_id = (
          SELECT account_id FROM conversations WHERE id = ${conversationId} LIMIT 1
        )
        LIMIT 1
      `;

      if (routing) {
        const teamId = routing.team_id;
        
        // Update ticket's team_id
        const [updatedTicket] = await tx`
          UPDATE tickets SET team_id = ${teamId}
          WHERE conversation_id = ${conversationId} AND status != 'resolved'
          RETURNING id
        `;

        if (updatedTicket) {
          const jwtPayload = c.get('jwtPayload') as any;
          const agentId = jwtPayload?.id;
          
          const [team] = await tx`SELECT name FROM teams WHERE id = ${teamId}`;
          const [label] = await tx`SELECT title FROM labels WHERE id = ${label_id}`;
          
          const content = `Tiket dialihkan ke tim ${team?.name} secara otomatis (Label: ${label?.title})`;

          await tx`
            INSERT INTO messages (
              account_id, conversation_id, ticket_id, sender_type, sender_id, content, message_type, status
            ) VALUES (
              (SELECT account_id FROM conversations WHERE id = ${conversationId} LIMIT 1),
              ${conversationId}, ${updatedTicket.id}, 'System', ${agentId || null}, ${content}, 'outgoing', 'sent'
            )
          `;
        }
      }
    });

    return c.json({ success: true }, 201);
  } catch (error) {
    console.error('Error assign label:', error);
    return c.json({ error: 'Gagal menambah label' }, 500);
  }
});

// DELETE /api/conversations/:id/labels/:label_id
conversationsRoutes.delete('/:id/labels/:label_id', async (c) => {
  const conversationId = parseInt(c.req.param('id'), 10);
  const labelId = parseInt(c.req.param('label_id'), 10);
  if (isNaN(conversationId) || isNaN(labelId)) return c.json({ error: 'ID tidak valid' }, 400);

  try {
    await sql`
      DELETE FROM conversation_labels 
      WHERE conversation_id = ${conversationId} AND label_id = ${labelId}
    `;
    return c.json({ success: true });
  } catch (error) {
    console.error('Error delete conversation label:', error);
    return c.json({ error: 'Gagal menghapus label' }, 500);
  }
});
