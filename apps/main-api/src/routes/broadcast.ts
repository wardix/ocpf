import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { redis } from '../config/redis';
import type { SendMessagePayload } from '@omnichannel/shared-types';
import { authMiddleware, getAccountId } from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';
import { dispatchWebhook } from '../utils/webhooks';

const app = new Hono();
app.use('/*', authMiddleware);

const broadcastSchema = z.object({
  contact_ids: z.array(z.number().int()).min(1, 'Pilih minimal satu kontak'),
  content: z.string().min(1, 'Isi pesan tidak boleh kosong'),
  inbox_id: z.number().int().optional()
});

// Rate limit khusus broadcast: Maksimal 1 request per menit per user
const broadcastRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 1,
  keyGenerator: (c) => `broadcast:${(c.get('jwtPayload') as any)?.id || 'unknown'}`
});

app.post('/', broadcastRateLimiter, zValidator('json', broadcastSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
  }
}), async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }
    const ACCOUNT_ID = getAccountId(c);

    const { contact_ids, content, inbox_id } = c.req.valid('json');

    const INBOX_ID = inbox_id || parseInt(process.env.INBOX_ID || '1');
    const agentId = jwtPayload.id;

    const contacts = await sql`
      SELECT id, phone_number FROM contacts WHERE id IN ${sql(contact_ids)} AND account_id = ${ACCOUNT_ID} AND deleted_at IS NULL
    `;

    (async () => {
      console.log(`[BROADCAST] Memulai broadcast ke ${contacts.length} pelanggan...`);
      for (const contact of contacts) {
        try {
          let [conversation] = await sql`
            SELECT id FROM conversations
            WHERE account_id = ${ACCOUNT_ID} AND inbox_id = ${INBOX_ID} AND contact_id = ${contact.id}
            LIMIT 1
          `;
          let isNewConversation = false;
          if (!conversation) {
            isNewConversation = true;
            [conversation] = await sql`
              INSERT INTO conversations (account_id, inbox_id, contact_id)
              VALUES (${ACCOUNT_ID}, ${INBOX_ID}, ${contact.id})
              RETURNING id;
            `;
          }

          const [msg] = await sql`
            INSERT INTO messages (
              account_id, conversation_id, ticket_id, sender_type, sender_id, 
              content, message_type, status, is_private
            ) VALUES (
              ${ACCOUNT_ID}, ${conversation.id}, null, 'User', ${agentId}, 
              ${content}, 'outgoing', 'sent', false
            )
            RETURNING *;
          `;

          const payload: SendMessagePayload = {
            event: 'message.send',
            data: {
              inbox_id: INBOX_ID,
              internal_message_id: msg.id,
              target_id: contact.phone_number,
              content: content,
              message_type: 'text'
            }
          };

          if (isNewConversation) {
            dispatchWebhook(ACCOUNT_ID, 'conversation.created', {
              id: Number(conversation.id),
              account_id: ACCOUNT_ID,
              inbox_id: INBOX_ID,
              contact_id: Number(contact.id)
            }).catch(e => console.error(e));
          }
          dispatchWebhook(ACCOUNT_ID, 'message.outgoing', msg).catch(e => console.error(e));
          
          const targetQueue = `queue:outgoing_messages:inbox_${INBOX_ID}`;
          await redis.rpush(targetQueue, JSON.stringify(payload));
          console.log(`[BROADCAST] Antrean ke ${contact.phone_number} terkirim.`);

          await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
          console.error(`[BROADCAST] Gagal mengirim ke contact ${contact.id}:`, err);
        }
      }
      console.log('[BROADCAST] Selesai!');
    })();

    return c.json({ success: true, message: `Broadcast sedang dikirim ke ${contacts.length} kontak secara background.` });
  } catch (error) {
    console.error('Error broadcast:', error);
    return c.json({ error: 'Gagal memproses broadcast' }, 500);
  }
});

export default app;