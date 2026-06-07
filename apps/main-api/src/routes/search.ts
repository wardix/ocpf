import { Hono } from 'hono';
import { sql } from '../config/database';
import { jwtMiddleware, getAccountId } from '../middleware/auth';

export const searchRoutes = new Hono();
searchRoutes.use('/*', jwtMiddleware);

searchRoutes.get('/', async (c) => {
  try {
    const accountId = getAccountId(c);
    const query = c.req.query('q')?.trim();
    const type = c.req.query('type') || 'all';
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const perPage = Math.min(50, Math.max(1, parseInt(c.req.query('per_page') || '20', 10)));
    const offset = (page - 1) * perPage;

    if (!query || query.length < 2) {
      return c.json({ error: 'Query minimal 2 karakter' }, 400);
    }

    const results: any = {};

    // Search Contacts
    if (type === 'all' || type === 'contacts') {
      const contacts = await sql`
        SELECT c.id, c.name, c.phone_number, c.email,
          conv.id as conversation_id
        FROM contacts c
        LEFT JOIN conversations conv ON conv.contact_id = c.id AND conv.account_id = ${accountId}
        WHERE c.account_id = ${accountId}
          AND c.deleted_at IS NULL
          AND (c.name ILIKE ${'%' + query + '%'}
               OR c.phone_number ILIKE ${'%' + query + '%'}
               OR c.email ILIKE ${'%' + query + '%'})
        ORDER BY c.updated_at DESC
        LIMIT ${perPage} OFFSET ${offset}
      `;

      const [countRow] = await sql`
        SELECT COUNT(*)::int as total FROM contacts
        WHERE account_id = ${accountId}
          AND deleted_at IS NULL
          AND (name ILIKE ${'%' + query + '%'}
               OR phone_number ILIKE ${'%' + query + '%'}
               OR email ILIKE ${'%' + query + '%'})
      `;

      results.contacts = { total: countRow?.total || 0, data: contacts };
    }

    // Search Messages (Full-text)
    if (type === 'all' || type === 'messages') {
      const messages = await sql`
        SELECT m.id as message_id, m.conversation_id, m.content, m.sender_type, m.created_at,
          con.name as contact_name,
          ts_headline('indonesian', m.content, plainto_tsquery('indonesian', ${query}),
            'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15') as headline
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        JOIN contacts con ON con.id = c.contact_id
        WHERE m.account_id = ${accountId}
          AND con.deleted_at IS NULL
          AND m.search_vector @@ plainto_tsquery('indonesian', ${query})
        ORDER BY ts_rank(m.search_vector, plainto_tsquery('indonesian', ${query})) DESC, m.created_at DESC
        LIMIT ${perPage} OFFSET ${offset}
      `;

      const [countRow] = await sql`
        SELECT COUNT(*)::int as total FROM messages
        WHERE account_id = ${accountId}
          AND search_vector @@ plainto_tsquery('indonesian', ${query})
      `;

      results.messages = { total: countRow?.total || 0, data: messages };
    }

    // Search Conversations (by contact name/phone)
    if (type === 'all' || type === 'conversations') {
      const conversations = await sql`
        SELECT c.id as conversation_id,
          con.name as contact_name, con.phone_number as contact_phone,
          t.status as ticket_status, u.name as assignee_name,
          (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
          c.updated_at
        FROM conversations c
        JOIN contacts con ON c.contact_id = con.id
        LEFT JOIN tickets t ON t.conversation_id = c.id AND t.status != 'resolved'
        LEFT JOIN users u ON t.assignee_id = u.id
        WHERE c.account_id = ${accountId}
          AND con.deleted_at IS NULL
          AND (con.name ILIKE ${'%' + query + '%'} OR con.phone_number ILIKE ${'%' + query + '%'})
        ORDER BY c.updated_at DESC
        LIMIT ${perPage} OFFSET ${offset}
      `;

      results.conversations = { total: conversations.length, data: conversations };
    }

    return c.json({ success: true, data: { query, results } });
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Terjadi kesalahan internal server' }, 500);
  }
});
