// apps/main-api/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import { jwt, sign } from 'hono/jwt';
import postgres from 'postgres';
import Redis from 'ioredis';
import path from 'path';
import type { 
  IncomingMessagePayload, 
  SendMessagePayload 
} from '@omnichannel/shared-types';
import { ServerWebSocket } from 'bun';

const app = new Hono();

// Aktifkan CORS agar frontend (port 5173) bisa akses backend (port 8000)
app.use('/api/*', cors());
app.use('/ws', cors()); // Opsional untuk beberapa skenario upgrade

// Sajikan file statis media (gambar/dokumen)
app.use('/uploads/*', serveStatic({ root: './public' }));

// =========================================================================
// 1. Koneksi Database & Redis (Valkey)
// =========================================================================
const sql = postgres(process.env.DATABASE_URL || 'postgres://localhost:5432/omnichannel');

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
});

const redisSub = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
});

// Dedicated connection for blocking pop (brpop)
const redisWorker = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
});

const QUEUE_INCOMING = 'queue:incoming_messages';
const QUEUE_OUTGOING = 'queue:outgoing_messages';
const PUB_SUB_CH = 'chat:events';

// Simpan daftar koneksi websocket aktif
const activeWebSockets = new Set<ServerWebSocket<any>>();

// =========================================================================
// 2. Background Worker: Menyimpan Pesan Masuk (Consumer)
// =========================================================================
async function startWorker() {
  console.log('Worker API: Berjalan (Siap menerima pesan dari Valkey)');
  
  while (true) {
    try {
      // Gunakan redisWorker agar tidak nge-block koneksi redis utama
      const result = await redisWorker.brpop(QUEUE_INCOMING, 0);
        if (result) {
          const [_, messageStr] = result;
          console.log('--- DEBUG: Menerima Payload dari Redis ---');
          console.log(messageStr);
          console.log('-----------------------------------------');

          const payload = JSON.parse(messageStr) as IncomingMessagePayload;
          
          if (payload.event === 'message.incoming') {
            const savedMessage = await processIncomingMessageToDB(payload.data);
          
          if (savedMessage) {
            // Beritahu semua client via Pub/Sub bahwa ada pesan baru
            await redis.publish(PUB_SUB_CH, JSON.stringify({
              event: 'message.new',
              data: savedMessage
            }));
          }
        }
      }
    } catch (err) {
      console.error('Worker processing error:', err);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

async function processIncomingMessageToDB(data: IncomingMessagePayload['data']) {
  try {
    const ACCOUNT_ID = 1;
    const INBOX_ID = 1;

    // Pastikan variabel tidak undefined untuk SQL
    const sourceJid = data.source_jid || 'unknown';
    const displayName = data.push_name || 'Unknown User';
    const timestamp = data.timestamp || Math.floor(Date.now() / 1000);
    const content = data.content || '';

    // 1. Cari atau Buat Kontak
    let [contact] = await sql`
      SELECT id FROM contacts WHERE phone_number = ${sourceJid} AND account_id = ${ACCOUNT_ID} LIMIT 1
    `;
    
    if (!contact) {
      [contact] = await sql`
        INSERT INTO contacts (account_id, name, phone_number)
        VALUES (${ACCOUNT_ID}, ${displayName}, ${sourceJid})
        RETURNING id;
      `;
    } else {
      await sql`
        UPDATE contacts SET name = ${displayName}, updated_at = NOW() 
        WHERE id = ${contact.id} AND name != ${displayName}
      `;
    }

    // 2. Cari Percakapan terakhir dari kontak ini
    let [conversation] = await sql`
      SELECT id, status FROM conversations
      WHERE account_id = ${ACCOUNT_ID} 
        AND inbox_id = ${INBOX_ID} 
        AND contact_id = ${contact.id}
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    if (!conversation) {
      // Jika belum pernah ada percakapan, buat baru
      [conversation] = await sql`
        INSERT INTO conversations (account_id, inbox_id, contact_id, status)
        VALUES (${ACCOUNT_ID}, ${INBOX_ID}, ${contact.id}, 'open')
        RETURNING id;
      `;
    } else if (conversation.status === 'resolved' || conversation.status === 'snoozed') {
      // Jika percakapan sudah ditutup/ditunda, buka kembali (reopen)
      [conversation] = await sql`
        UPDATE conversations SET status = 'open', updated_at = NOW() 
        WHERE id = ${conversation.id}
        RETURNING id;
      `;
    } else {
      // Jika masih open/pending, cukup update waktunya saja
      await sql`
        UPDATE conversations SET updated_at = NOW() WHERE id = ${conversation.id}
      `;
    }

    // 3. Masukkan Pesan ke Tabel Messages
    const finalContent = data.participant_id 
      ? `[${data.participant_name || 'Member'}]: ${content}` 
      : content;

    const [msg] = await sql`
      INSERT INTO messages (
        account_id, conversation_id, sender_type, sender_id, 
        content, message_type, status, created_at
      ) VALUES (
        ${ACCOUNT_ID}, ${conversation.id}, 'Contact', ${contact.id}, 
        ${finalContent}, 'incoming', 'delivered', to_timestamp(${timestamp})
      )
      RETURNING *;
    `;

    // 4. Jika ada media, simpan file secara lokal dan catat ke tabel attachments
    let attachmentData = null;
    if (data.media) {
      try {
        const { mimetype, data_base64, filename } = data.media;
        
        // Buat nama file unik
        const ext = mimetype.split('/')[1]?.split(';')[0] || 'bin';
        const safeFilename = filename || `media_${Date.now()}_${data.wa_message_id}.${ext}`;
        
        // Decode base64 dan simpan ke disk
        const buffer = Buffer.from(data_base64, 'base64');
        const uploadPath = path.join(process.cwd(), 'public', 'uploads', safeFilename);
        await Bun.write(uploadPath, buffer);
        
        const fileUrl = `/uploads/${safeFilename}`;
        
        const [attachment] = await sql`
          INSERT INTO attachments (message_id, file_type, file_url)
          VALUES (${msg.id}, ${mimetype}, ${fileUrl})
          RETURNING *;
        `;
        attachmentData = attachment;
      } catch (mediaErr) {
        console.error('Gagal memproses media lampiran:', mediaErr);
      }
    }

    return { 
      ...msg, 
      contact_name: displayName,
      attachments: attachmentData ? [attachmentData] : [] 
    };
  } catch (error) {
    console.error("Gagal menyimpan ke database:", error);
    return null;
  }
}

// =========================================================================
// 3. Redis Pub/Sub Listener (Untuk Real-time Broadcast)
// =========================================================================
redisSub.subscribe(PUB_SUB_CH);
redisSub.on('message', (channel, message) => {
  if (channel === PUB_SUB_CH) {
    // Kirim pesan ke SEMUA koneksi websocket yang aktif
    activeWebSockets.forEach((ws) => {
      ws.send(message);
    });
  }
});

// =========================================================================
// 4. API Routes (Hono)
// =========================================================================
app.get('/', (c) => c.text('Main API Omnichannel (Bun + Hono + WebSocket) ✅'));

// === ENDPOINT AUTHENTICATION ===
app.post('/api/auth/login', async (c) => {
  try {
    const { email, password } = await c.req.json();

    const [user] = await sql`
      SELECT id, name, email, password_hash FROM users WHERE email = ${email} LIMIT 1
    `;

    if (!user) {
      return c.json({ error: 'Kredensial tidak valid' }, 401);
    }

    const isMatch = await Bun.password.verify(password, user.password_hash);
    
    if (!isMatch) {
      return c.json({ error: 'Kredensial tidak valid' }, 401);
    }

    // Buat Token JWT
    const payload = {
      id: user.id,
      name: user.name,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 // 24 Jam
    };
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    const token = await sign(payload, secret);

    return c.json({ 
      success: true, 
      token, 
      user: { id: user.id, name: user.name, email: user.email } 
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Terjadi kesalahan pada server' }, 500);
  }
});

// === MIDDLEWARE JWT (PROTECT ROUTES BELOW) ===
app.use('/api/conversations/*', jwt({ secret: process.env.JWT_SECRET || 'fallback_secret', alg: 'HS256' }));
app.use('/api/messages/*', jwt({ secret: process.env.JWT_SECRET || 'fallback_secret', alg: 'HS256' }));

// Ambil semua percakapan aktif untuk sidebar
app.get('/api/conversations', async (c) => {
  try {
    const status = c.req.query('status') || 'open'; // default ke open
    const assigneeFilter = c.req.query('assignee'); // 'me' atau 'unassigned' atau 'all'
    const isResolved = status === 'resolved';
    
    // Ambil ID agen yang sedang login dari JWT
    const jwtPayload = c.get('jwtPayload');
    const currentAgentId = jwtPayload?.id;

    const convs = await sql`
      SELECT 
        c.id, 
        c.status, 
        c.updated_at, 
        c.assignee_id,
        u.name as assignee_name,
        con.name as contact_name, 
        con.phone_number as contact_phone,
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM conversations c
      JOIN contacts con ON c.contact_id = con.id
      LEFT JOIN users u ON c.assignee_id = u.id
      WHERE c.account_id = 1 AND (
        (${isResolved}::boolean = true AND c.status = 'resolved') OR 
        (${isResolved}::boolean = false AND c.status != 'resolved')
      )
      AND (
        ${assigneeFilter === 'me'}::boolean = false OR c.assignee_id = ${currentAgentId}
      )
      AND (
        ${assigneeFilter === 'unassigned'}::boolean = false OR c.assignee_id IS NULL
      )
      ORDER BY c.updated_at DESC
    `;
    return c.json(convs);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Gagal mengambil daftar percakapan' }, 500);
  }
});

// Ambil riwayat pesan untuk percakapan tertentu
app.get('/api/conversations/:id/messages', async (c) => {
  const conversationId = c.req.param('id');
  try {
    // Mengambil pesan beserta attachment-nya
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
      GROUP BY m.id
      ORDER BY m.created_at ASC
    `;
    return c.json(messages);
  } catch (error) {
    return c.json({ error: 'Gagal mengambil pesan' }, 500);
  }
});

// Endpoint kirim pesan
app.post('/api/messages/send', async (c) => {
  const tStart = Date.now();
  console.log(`\n[DEBUG-LATENCY] (${tStart}) API menerima request POST kirim pesan.`);
  try {
    const body = await c.req.json();
    const { target_id, content, conversation_id, account_id, media } = body;

    const tDbStart = Date.now();
    const [msg] = await sql`
      INSERT INTO messages (
        account_id, conversation_id, sender_type, sender_id, 
        content, message_type, status
      ) VALUES (
        ${account_id || 1}, ${conversation_id}, 'User', NULL, 
        ${content || ''}, 'outgoing', 'sent'
      )
      RETURNING *;
    `;
    
    let attachmentData = null;
    if (media) {
      try {
        const { mimetype, data_base64, filename } = media;
        const ext = mimetype.split('/')[1]?.split(';')[0] || 'bin';
        const safeFilename = filename || `media_out_${Date.now()}_${msg.id}.${ext}`;
        const buffer = Buffer.from(data_base64, 'base64');
        const uploadPath = path.join(process.cwd(), 'public', 'uploads', safeFilename);
        await Bun.write(uploadPath, buffer);
        
        const fileUrl = `/uploads/${safeFilename}`;
        const [attachment] = await sql`
          INSERT INTO attachments (message_id, file_type, file_url)
          VALUES (${msg.id}, ${mimetype}, ${fileUrl})
          RETURNING *;
        `;
        attachmentData = attachment;
      } catch (err) {
        console.error('Gagal memproses lampiran media yang dikirim:', err);
      }
    }
    
    const tDbEnd = Date.now();
    console.log(`[DEBUG-LATENCY] (${tDbEnd}) Simpan DB PostgreSQL selesai (Memakan waktu: ${tDbEnd - tDbStart}ms)`);

    // Beritahu WA Adapter via Redis Queue
    const payload: SendMessagePayload = {
      event: 'message.send',
      data: {
        internal_message_id: msg.id,
        target_id: target_id,
        content: content || '',
        message_type: media ? 'image' : 'text',
        media: media
      }
    };
    
    // Sisipkan _queued_at sementara untuk mengukur latency Redis
    const payloadStr = JSON.stringify({ ...payload, _queued_at: Date.now() });
    await redis.rpush(QUEUE_OUTGOING, payloadStr);
    console.log(`[DEBUG-LATENCY] (${Date.now()}) Pesan berhasil dilempar ke antrean Redis (QUEUE_OUTGOING).`);
    
    const finalMsgData = {
      ...msg,
      attachments: attachmentData ? [attachmentData] : []
    };
    
    // Broadcast ke UI kita sendiri juga (Agar bubble chat langsung muncul tanpa nunggu WA Adapter)
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

// Endpoint untuk update status tiket (misal: Tutup Tiket)
app.patch('/api/conversations/:id/status', async (c) => {
  const conversationId = c.req.param('id');
  try {
    const jwtPayload = c.get('jwtPayload');
    const agentId = jwtPayload.id;
    const agentName = jwtPayload.name;

    const body = await c.req.json();
    const { status } = body; // 'open', 'resolved', etc.

    if (!['open', 'pending', 'snoozed', 'resolved'].includes(status)) {
      return c.json({ error: 'Status tidak valid' }, 400);
    }

    const [conversation] = await sql`
      UPDATE conversations 
      SET status = ${status}, updated_at = NOW() 
      WHERE id = ${conversationId}
      RETURNING *;
    `;

    if (!conversation) {
      return c.json({ error: 'Percakapan tidak ditemukan' }, 404);
    }

    // Dual-write: Catat ke conversation_events dan pesan sistem
    await sql`
      INSERT INTO conversation_events (account_id, conversation_id, actor_type, actor_id, event_type, event_data)
      VALUES (${conversation.account_id}, ${conversation.id}, 'User', ${agentId}, 'status_changed', ${sql.json({ new_status: status })});
    `;
    
    let systemText = `Tiket diubah menjadi ${status}`;
    if (status === 'resolved') systemText = `Tiket ditutup oleh Agen ${agentName}`;
    
    const [sysMsg] = await sql`
      INSERT INTO messages (account_id, conversation_id, sender_type, sender_id, content, message_type, status)
      VALUES (${conversation.account_id}, ${conversation.id}, 'System', NULL, ${systemText}, 'template', 'sent')
      RETURNING *;
    `;
    await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: sysMsg }));

    return c.json({ success: true, data: conversation });
  } catch (error) {
    console.error('Error update status:', error);
    return c.json({ success: false, error: 'Gagal update status' }, 500);
  }
});

// Endpoint untuk mengambil alih tiket (Assign to me)
app.patch('/api/conversations/:id/assign', async (c) => {
  const conversationId = c.req.param('id');
  try {
    const jwtPayload = c.get('jwtPayload');
    const agentId = jwtPayload.id;
    const agentName = jwtPayload.name;

    const [conversation] = await sql`
      UPDATE conversations 
      SET assignee_id = ${agentId}, updated_at = NOW() 
      WHERE id = ${conversationId} AND assignee_id IS NULL
      RETURNING *;
    `;

    if (!conversation) {
      // Cek apakah memang tidak ketemu atau sudah diambil orang lain
      const [existing] = await sql`SELECT assignee_id FROM conversations WHERE id = ${conversationId}`;
      if (!existing) return c.json({ error: 'Percakapan tidak ditemukan' }, 404);
      if (existing.assignee_id !== null) return c.json({ error: 'Tiket sudah diambil agen lain' }, 400);
    }

    // Dual-write: Catat ke conversation_events dan pesan sistem
    await sql`
      INSERT INTO conversation_events (account_id, conversation_id, actor_type, actor_id, event_type, event_data)
      VALUES (${conversation.account_id}, ${conversation.id}, 'User', ${agentId}, 'assigned', ${sql.json({ new_assignee_id: agentId })});
    `;
    
    const [sysMsg] = await sql`
      INSERT INTO messages (account_id, conversation_id, sender_type, sender_id, content, message_type, status)
      VALUES (${conversation.account_id}, ${conversation.id}, 'System', NULL, ${`Tiket diambil alih oleh ${agentName}`}, 'template', 'sent')
      RETURNING *;
    `;
    await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: sysMsg }));

    return c.json({ success: true, data: conversation });
  } catch (error) {
    console.error('Error assign ticket:', error);
    return c.json({ success: false, error: 'Gagal mengambil tiket' }, 500);
  }
});

// Jalankan Worker
startWorker();

// =========================================================================
// 5. Bun HTTP + WebSocket Server
// =========================================================================
const PORT = Number(process.env.PORT) || 3000;

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    // Jika request adalah upgrade websocket, lakukan upgrade
    if (server.upgrade(req)) {
      return; 
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      console.log('Browser/Agen Terhubung via WebSocket 🌐');
      activeWebSockets.add(ws);
    },
    message(ws, message) {
      // (Optional) Handle pesan dari client jika perlu
    },
    close(ws) {
      console.log('Browser/Agen Terputus ❌');
      activeWebSockets.delete(ws);
    },
  },
});

console.log(`Server API & WebSocket berjalan di port ${server.port}`);