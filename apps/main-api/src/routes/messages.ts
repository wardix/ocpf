import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { redis, PUB_SUB_CH } from '../config/redis';
import { jwtMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';
import path from 'path';
import type { SendMessagePayload } from '@omnichannel/shared-types';

export const messagesRoutes = new Hono();

messagesRoutes.use('/*', jwtMiddleware);

const sendMessageSchema = z.object({
  target_id: z.string().min(5),
  content: z.string().optional(),
  conversation_id: z.number().int(),
  is_private: z.boolean().optional(),
  media: z.object({
    mimetype: z.string(),
    data_base64: z.string(),
    filename: z.string().optional()
  }).optional()
}).refine(data => data.content || data.media, {
  message: "Pesan teks atau media harus diisi"
});

// Rate limit pengiriman pesan: Maksimal 30 request per menit per user
const sendMessageRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (c) => `message_send:${(c.get('jwtPayload') as any)?.id || 'unknown'}`
});

messagesRoutes.post('/send', sendMessageRateLimiter, zValidator('json', sendMessageSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
  }
}), async (c) => {
  const tStart = Date.now();
  console.log(`\\n[DEBUG-LATENCY] (${tStart}) API menerima request POST kirim pesan.`);
  try {
    const jwtPayload = c.get('jwtPayload');
    const agentId = jwtPayload.id;
    const accountId = jwtPayload.account_id || 1; 

    const { target_id, content, conversation_id, media, is_private } = c.req.valid('json');

    const [conv] = await sql`
      SELECT c.id as conversation_id, c.inbox_id, t.id as ticket_id, t.assignee_id 
      FROM conversations c
      LEFT JOIN tickets t ON t.conversation_id = c.id AND t.status != 'resolved'
      WHERE c.id = ${conversation_id} AND c.account_id = ${accountId} LIMIT 1
    `;
    if (!conv) return c.json({ error: 'Percakapan tidak ditemukan' }, 404);
    
    if (conv.ticket_id && conv.assignee_id !== agentId) {
      return c.json({ error: 'Akses ditolak: Anda harus mengambil alih tiket aktif ini terlebih dahulu.' }, 403);
    }

    const inboxId = conv.inbox_id;

    const tDbStart = Date.now();
    let attachmentData = null;

    const msg = await sql.begin(async (tx) => {
      const [insertedMsg] = await tx`
        INSERT INTO messages (
          account_id, conversation_id, ticket_id, sender_type, sender_id, 
          content, message_type, status, is_private
        ) VALUES (
          ${accountId}, ${conv.conversation_id}, ${conv.ticket_id || null}, 'User', ${agentId}, 
          ${content || ''}, 'outgoing', 'sent', ${is_private || false}
        )
        RETURNING *;
      `;
      
      if (media) {
        try {
          const { mimetype, data_base64, filename } = media;
          
          const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'audio/ogg', 'audio/mpeg', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
          if (!allowedMimeTypes.includes(mimetype) && !mimetype.startsWith('audio/')) {
            throw new Error(`MIME type tidak diizinkan: ${mimetype}`);
          }

          const buffer = Buffer.from(data_base64, 'base64');
          if (buffer.length > 25 * 1024 * 1024) {
            throw new Error('Ukuran file melebihi batas 25MB');
          }

          const originalName = filename ? filename.replace(/^.*[\\\\\\/]/, '').replace(/[^a-zA-Z0-9.\\-_]/g, '_') : 'unnamed_file';
          const ext = mimetype.split('/')[1]?.split(';')[0] || 'bin';
          const safeFilename = `${crypto.randomUUID()}.${ext}`;
          
          const uploadPath = path.join(process.cwd(), 'public', 'uploads', safeFilename);
          await Bun.write(uploadPath, buffer);
          
          const fileUrl = `/uploads/${safeFilename}`;
          const [attachment] = await tx`
            INSERT INTO attachments (message_id, file_type, file_url, original_filename)
            VALUES (${insertedMsg.id}, ${mimetype}, ${fileUrl}, ${originalName})
            RETURNING *;
          `;
          attachmentData = attachment;
        } catch (err: any) {
          console.error('Gagal memproses lampiran media yang dikirim:', err);
          throw new Error('ATTACHMENT_FAILED: ' + err.message); // Akan mentrigger rollback tx
        }
      }
      return insertedMsg;
    });
    
    const tDbEnd = Date.now();
    console.log(`[DEBUG-LATENCY] (${tDbEnd}) Simpan DB PostgreSQL selesai (Memakan waktu: ${tDbEnd - tDbStart}ms)`);

    if (!is_private) {
      const payload: SendMessagePayload = {
        event: 'message.send',
        data: {
          inbox_id: inboxId,
          internal_message_id: msg.id,
          target_id: target_id,
          content: content || '',
          message_type: media ? 'image' : 'text',
          media: media
        }
      };
      
      const payloadStr = JSON.stringify({ ...payload, _queued_at: Date.now() });
      const targetQueue = `queue:outgoing_messages:inbox_${inboxId}`;
      await redis.rpush(targetQueue, payloadStr);
      console.log(`[DEBUG-LATENCY] (${Date.now()}) Pesan berhasil dilempar ke antrean Redis (${targetQueue}).`);
    } else {
      console.log(`[DEBUG-LATENCY] (${Date.now()}) Pesan adalah Private Note, dilewati dari antrean Redis.`);
    }
    
    const finalMsgData = {
      ...msg,
      attachments: attachmentData ? [attachmentData] : []
    };
    
    await redis.publish(PUB_SUB_CH, JSON.stringify({
      event: 'message.new',
      data: finalMsgData
    }));

    console.log(`[DEBUG-LATENCY] Total proses di Main API selesai dalam ${Date.now() - tStart}ms`);
    return c.json({ success: true, data: finalMsgData });
  } catch (error) {
    console.error('Error pengiriman pesan:', error);
    return c.json({ success: false, error: 'Gagal mengirim' }, 500);
  }
});
