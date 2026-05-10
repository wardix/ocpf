// apps/main-api/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import postgres from 'postgres';
import Redis from 'ioredis';
import type { 
  IncomingMessagePayload, 
  SendMessagePayload 
} from '@omnichannel/shared-types';
import { ServerWebSocket } from 'bun';

const app = new Hono();

// Aktifkan CORS agar frontend (port 5173) bisa akses backend (port 8000)
app.use('/api/*', cors());
app.use('/ws', cors()); // Opsional untuk beberapa skenario upgrade

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

    return { ...msg, contact_name: displayName };
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

// Ambil semua percakapan aktif untuk sidebar
app.get('/api/conversations', async (c) => {
  try {
    const status = c.req.query('status') || 'open'; // default ke open
    const isResolved = status === 'resolved';

    const convs = await sql`
      SELECT 
        c.id, 
        c.status, 
        c.updated_at, 
        con.name as contact_name, 
        con.phone_number as contact_phone,
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM conversations c
      JOIN contacts con ON c.contact_id = con.id
      WHERE c.account_id = 1 AND (
        (${isResolved}::boolean = true AND c.status = 'resolved') OR 
        (${isResolved}::boolean = false AND c.status != 'resolved')
      )
      ORDER BY c.updated_at DESC
    `;
    return c.json(convs);
  } catch (error) {
    return c.json({ error: 'Gagal mengambil daftar percakapan' }, 500);
  }
});

// Ambil riwayat pesan untuk percakapan tertentu
app.get('/api/conversations/:id/messages', async (c) => {
  const conversationId = c.req.param('id');
  try {
    const messages = await sql`
      SELECT * FROM messages 
      WHERE conversation_id = ${conversationId} 
      ORDER BY created_at ASC
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
    const { target_id, content, conversation_id, account_id } = body;

    const tDbStart = Date.now();
    const [msg] = await sql`
      INSERT INTO messages (
        account_id, conversation_id, sender_type, sender_id, 
        content, message_type, status
      ) VALUES (
        ${account_id || 1}, ${conversation_id}, 'User', NULL, 
        ${content}, 'outgoing', 'sent'
      )
      RETURNING *;
    `;
    const tDbEnd = Date.now();
    console.log(`[DEBUG-LATENCY] (${tDbEnd}) Simpan DB PostgreSQL selesai (Memakan waktu: ${tDbEnd - tDbStart}ms)`);

    // Beritahu WA Adapter via Redis Queue
    const payload: SendMessagePayload = {
      event: 'message.send',
      data: {
        internal_message_id: msg.id,
        target_id: target_id,
        content: content,
        message_type: 'text'
      }
    };
    
    // Sisipkan _queued_at sementara untuk mengukur latency Redis
    const payloadStr = JSON.stringify({ ...payload, _queued_at: Date.now() });
    await redis.rpush(QUEUE_OUTGOING, payloadStr);
    console.log(`[DEBUG-LATENCY] (${Date.now()}) Pesan berhasil dilempar ke antrean Redis (QUEUE_OUTGOING).`);
    
    // Broadcast ke UI kita sendiri juga (Agar bubble chat langsung muncul tanpa nunggu WA Adapter)
    await redis.publish(PUB_SUB_CH, JSON.stringify({
      event: 'message.new',
      data: msg
    }));

    console.log(`[DEBUG-LATENCY] Total proses di Main API selesai dalam ${Date.now() - tStart}ms`);
    return c.json({ success: true, data: msg });
  } catch (error) {
    console.error('Error pengiriman pesan:', error);
    return c.json({ success: false, error: 'Gagal mengirim' }, 500);
  }
});

// Endpoint untuk update status tiket (misal: Tutup Tiket)
app.patch('/api/conversations/:id/status', async (c) => {
  const conversationId = c.req.param('id');
  try {
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

    return c.json({ success: true, data: conversation });
  } catch (error) {
    console.error('Error update status:', error);
    return c.json({ success: false, error: 'Gagal update status' }, 500);
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