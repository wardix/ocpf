import { Hono, type Context } from 'hono';
import postgres from 'postgres';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { redis } from '../config/redis';
import { dispatchWebhook } from '../utils/webhooks';

export const widgetRoutes = new Hono();

interface WidgetConfig {
  allowed_domains?: string | null;
  [key: string]: unknown;
}

// Helper untuk validasi CORS domain whitelist
function validateOrigin(c: Context, widgetConfig: WidgetConfig | null | undefined): boolean {
  const origin = c.req.header('origin');
  const referer = c.req.header('referer');
  
  let requestHost: string | null = null;
  if (origin) {
    requestHost = origin.replace(/^https?:\/\//, '').split(':')[0]?.toLowerCase() || null;
  } else if (referer) {
    try {
      requestHost = new URL(referer).hostname.toLowerCase();
    } catch (e) {
      // Invalid URL
    }
  }

  if (!requestHost) return true; // Lolos jika client bukan dari browser standard (misal curl/testing)

  const allowedDomains = widgetConfig?.allowed_domains
    ? String(widgetConfig.allowed_domains)
        .split(',')
        .map(d => d.trim().toLowerCase())
        .filter(Boolean)
    : [];

  if (allowedDomains.length === 0) return true; // Lolos jika admin tidak menyetel whitelist

  return allowedDomains.some(domain => {
    return requestHost === domain || requestHost!.endsWith('.' + domain);
  });
}

// GET /api/widget/config - Ambil config bootstrap widget untuk suatu inbox
widgetRoutes.get('/config', async (c) => {
  const inboxIdStr = c.req.query('inbox_id');
  if (!inboxIdStr) return c.json({ error: 'inbox_id diperlukan' }, 400);
  
  const inboxId = parseInt(inboxIdStr, 10);
  if (isNaN(inboxId)) return c.json({ error: 'inbox_id tidak valid' }, 400);

  try {
    const [inbox] = await sql`
      SELECT id, name, description, greeting_message, widget_config 
      FROM inboxes 
      WHERE id = ${inboxId} AND is_active = true LIMIT 1
    `;
    
    if (!inbox) {
      return c.json({ error: 'Inbox tidak ditemukan atau tidak aktif' }, 404);
    }

    // Validasi CORS
    if (!validateOrigin(c, inbox.widget_config)) {
      return c.json({ error: 'Origin website ini tidak diizinkan untuk memuat widget' }, 403);
    }

    return c.json({
      success: true,
      data: {
        inbox_id: Number(inbox.id),
        name: inbox.name,
        description: inbox.description,
        greeting_message: inbox.greeting_message,
        config: inbox.widget_config || {}
      }
    });
  } catch (error) {
    console.error('Error GET widget config:', error);
    return c.json({ error: 'Gagal mengambil konfigurasi widget' }, 500);
  }
});

const sessionInitSchema = z.object({
  inbox_id: z.number().int().positive(),
  fingerprint: z.string().min(1),
  session_token: z.string().optional(),
  name: z.string().optional(),
  email: z.string().email().optional()
});

// POST /api/widget/session - Restore atau inisialisasi session baru
widgetRoutes.post('/session', zValidator('json', sessionInitSchema), async (c) => {
  try {
    const { inbox_id, fingerprint, session_token, name, email } = c.req.valid('json');

    // 1. Cek validitas Inbox
    const [inbox] = await sql`
      SELECT id, account_id, greeting_message, widget_config 
      FROM inboxes 
      WHERE id = ${inbox_id} AND is_active = true LIMIT 1
    `;
    if (!inbox) {
      return c.json({ error: 'Inbox tidak ditemukan atau tidak aktif' }, 404);
    }
    const accountId = Number(inbox.account_id);

    // Validasi CORS
    if (!validateOrigin(c, inbox.widget_config)) {
      return c.json({ error: 'Origin website ini tidak diizinkan' }, 403);
    }

    let session = null;

    // 2. Restore session jika ada token
    if (session_token) {
      const [existingSession] = await sql`
        SELECT * FROM widget_sessions 
        WHERE session_token = ${session_token} AND inbox_id = ${inbox_id} LIMIT 1
      `;
      if (existingSession) {
        session = existingSession;
      }
    }

    // 3. Restore session berdasarkan fingerprint jika token tidak ada / invalid
    if (!session) {
      const [existingSession] = await sql`
        SELECT * FROM widget_sessions 
        WHERE fingerprint = ${fingerprint} AND inbox_id = ${inbox_id} LIMIT 1
      `;
      if (existingSession) {
        session = existingSession;
      }
    }

    // Jika session ditemukan, ambil 50 chat history teratas
    if (session) {
      await sql`
        UPDATE widget_sessions SET last_seen_at = NOW() WHERE id = ${session.id}
      `;

      const messages = await sql`
        SELECT m.id, m.content, m.sender_type, m.created_at, m.conversation_id, m.ticket_id
        FROM messages m
        WHERE m.conversation_id = ${session.conversation_id} AND m.account_id = ${accountId}
        ORDER BY m.id ASC
        LIMIT 50
      `;

      return c.json({
        success: true,
        data: {
          session_token: session.session_token,
          contact_id: Number(session.contact_id),
          conversation_id: Number(session.conversation_id),
          messages
        }
      });
    }

    // 4. Jika session tidak ditemukan, butuh pre-chat info
    if (!name || !email) {
      return c.json({
        success: false,
        need_prechat: true,
        message: 'Informasi pre-chat (name & email) diperlukan untuk inisialisasi chat baru.'
      });
    }

    // 5. Flow pembuatan session baru
    const sessionToken = crypto.randomUUID();
    const ipAddress = c.req.header('x-forwarded-for') || null;
    const userAgent = c.req.header('user-agent') || null;

    let contactData: postgres.Row | null = null;
    let isNewContact = false;
    let isNewConversation = false;

    const result = await sql.begin(async (tx: postgres.Sql) => {
      // 5a. Cari/buat kontak
      let contactId: number;
      const [existingContact] = await tx`
        SELECT id FROM contacts 
        WHERE email = ${email} AND account_id = ${accountId} AND deleted_at IS NULL LIMIT 1
      `;
      
      if (existingContact) {
        contactId = Number(existingContact.id);
      } else {
        isNewContact = true;
        const virtualPhone = `widget_${fingerprint.substring(0, 15)}_${Date.now().toString().slice(-4)}`;
        const [newContact] = await tx`
          INSERT INTO contacts (account_id, name, email, phone_number)
          VALUES (${accountId}, ${name}, ${email}, ${virtualPhone})
          RETURNING *
        `;
        if (!newContact) throw new Error('FAILED_TO_CREATE_CONTACT');
        contactId = Number(newContact.id);
        contactData = newContact;
      }

      // 5b. Buat conversation baru
      isNewConversation = true;
      const [newConv] = await tx`
        INSERT INTO conversations (account_id, inbox_id, contact_id)
        VALUES (${accountId}, ${inbox_id}, ${contactId})
        RETURNING id
      `;
      if (!newConv) throw new Error('FAILED_TO_CREATE_CONVERSATION');
      const conversationId = Number(newConv.id);

      // 5c. Buat tiket baru
      const [newTicket] = await tx`
        INSERT INTO tickets (account_id, conversation_id, status)
        VALUES (${accountId}, ${conversationId}, 'open')
        RETURNING id
      `;
      if (!newTicket) throw new Error('FAILED_TO_CREATE_TICKET');
      const ticketId = Number(newTicket.id);

      // 5d. Buat widget session
      await tx`
        INSERT INTO widget_sessions (
          account_id, inbox_id, contact_id, conversation_id, fingerprint, session_token, ip_address, user_agent
        )
        VALUES (
          ${accountId}, ${inbox_id}, ${contactId}, ${conversationId}, ${fingerprint}, ${sessionToken}, ${ipAddress}, ${userAgent}
        )
      `;

      // 5e. Masukkan Greeting Message jika terkonfigurasi
      let welcomeMessages: postgres.Row[] = [];
      if (inbox.greeting_message) {
        const [greetMsg] = await tx`
          INSERT INTO messages (conversation_id, ticket_id, account_id, sender_type, content)
          VALUES (${conversationId}, ${ticketId}, ${accountId}, 'System', ${inbox.greeting_message})
          RETURNING *
        `;
        if (greetMsg) {
          welcomeMessages.push(greetMsg);
        }
      }

      return { contactId, conversationId, welcomeMessages };
    });

    if (isNewContact && contactData) {
      dispatchWebhook(accountId, 'contact.created', contactData).catch(e => console.error(e));
    }
    if (isNewConversation) {
      dispatchWebhook(accountId, 'conversation.created', {
        id: Number(result.conversationId),
        account_id: accountId,
        inbox_id: inbox_id,
        contact_id: Number(result.contactId)
      }).catch(e => console.error(e));
    }

    return c.json({
      success: true,
      data: {
        session_token: sessionToken,
        contact_id: result.contactId,
        conversation_id: result.conversationId,
        messages: result.welcomeMessages
      }
    });

  } catch (error) {
    console.error('Error init session:', error);
    return c.json({ error: 'Gagal menginisialisasi sesi chat' }, 500);
  }
});

const postMessageSchema = z.object({
  session_token: z.string().min(1),
  content: z.string().min(1).max(5000)
});

// POST /api/widget/message - Pengiriman pesan dari visitor
widgetRoutes.post('/message', zValidator('json', postMessageSchema), async (c) => {
  const { session_token, content } = c.req.valid('json');

  try {
    const [session] = await sql`
      SELECT s.*, i.widget_config 
      FROM widget_sessions s
      JOIN inboxes i ON s.inbox_id = i.id
      WHERE s.session_token = ${session_token} LIMIT 1
    `;
    if (!session) {
      return c.json({ error: 'Sesi tidak valid' }, 401);
    }

    // Validasi CORS
    if (!validateOrigin(c, session.widget_config)) {
      return c.json({ error: 'Origin website ini tidak diizinkan' }, 403);
    }

    const conversationId = Number(session.conversation_id);
    const accountId = Number(session.account_id);

    // Cari tiket aktif
    const [activeTicket] = await sql`
      SELECT id FROM tickets 
      WHERE conversation_id = ${conversationId} AND status != 'resolved' 
      ORDER BY id DESC LIMIT 1
    `;
    const ticketId = activeTicket ? Number(activeTicket.id) : null;

    const [newMessage] = await sql`
      INSERT INTO messages (conversation_id, ticket_id, account_id, sender_type, content)
      VALUES (${conversationId}, ${ticketId}, ${accountId}, 'Contact', ${content})
      RETURNING *
    `;

    await sql`
      UPDATE conversations SET updated_at = NOW() WHERE id = ${conversationId}
    `;

    // Broadcast ke WebSocket agent dashboard
    const wsPayload = {
      event: 'message.new',
      data: {
        id: Number(newMessage.id),
        content: newMessage.content,
        sender_type: 'Contact',
        created_at: newMessage.created_at,
        conversation_id: conversationId,
        ticket_id: ticketId,
        account_id: accountId
      }
    };
    
    await redis.publish('chat:events', JSON.stringify(wsPayload));

    dispatchWebhook(accountId, 'message.incoming', newMessage).catch(e => console.error(e));

    return c.json({
      success: true,
      data: newMessage
    });
  } catch (error) {
    console.error('Error POST widget message:', error);
    return c.json({ error: 'Gagal mengirim pesan' }, 500);
  }
});
