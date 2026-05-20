// apps/main-api/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import { jwt, sign } from 'hono/jwt';
import postgres from 'postgres';
import Redis from 'ioredis';
import path from 'path';
import fs from 'fs';
import type { 
  IncomingMessagePayload, 
  SendMessagePayload 
} from '@omnichannel/shared-types';
import { ServerWebSocket } from 'bun';

const app = new Hono();

// Load Chatbot Rules
let chatbotRules: any = null;
try {
  const chatbotFile = fs.readFileSync(path.join(process.cwd(), 'chatbot.json'), 'utf-8');
  chatbotRules = JSON.parse(chatbotFile);
  console.log('Chatbot rules loaded successfully.');
} catch (e) {
  console.log('No chatbot.json found or invalid format. Chatbot is disabled.');
}

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
    console.log(`\n[DEBUG-ECHO] Memproses pesan masuk: ${data.wa_message_id}`);
    console.log(`[DEBUG-ECHO] is_host_echo bernilai:`, data.is_host_echo);

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

    // 2. Cari Percakapan (Wadah Abadi) dari kontak ini
    let [conversation] = await sql`
      SELECT id FROM conversations
      WHERE account_id = ${ACCOUNT_ID} 
        AND inbox_id = ${INBOX_ID} 
        AND contact_id = ${contact.id}
      LIMIT 1
    `;

    if (!conversation) {
      [conversation] = await sql`
        INSERT INTO conversations (account_id, inbox_id, contact_id)
        VALUES (${ACCOUNT_ID}, ${INBOX_ID}, ${contact.id})
        RETURNING id;
      `;
    }

    // 3. Cari Tiket (Sesi Masalah) terakhir dari percakapan ini
    let [ticket] = await sql`
      SELECT id, status, is_bot_active, bot_state FROM tickets
      WHERE account_id = ${ACCOUNT_ID} AND conversation_id = ${conversation.id}
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    // Cek Global Commands
    let triggeredGlobalCommand = false;
    if (chatbotRules && chatbotRules.global_commands) {
      const commandKey = content.trim().toLowerCase();
      if (chatbotRules.global_commands[commandKey]) {
        triggeredGlobalCommand = true;
        const targetState = chatbotRules.global_commands[commandKey];
        
        if (ticket && ticket.status !== 'resolved') {
          [ticket] = await sql`
            UPDATE tickets 
            SET is_bot_active = true, bot_state = ${targetState}, updated_at = NOW() 
            WHERE id = ${ticket.id}
            RETURNING id, status, is_bot_active, bot_state;
          `;
        }
      }
    }

    if (!ticket || ticket.status === 'resolved') {
      // Jika belum ada tiket atau tiket terakhir sudah ditutup, BUAT TIKET BARU
      [ticket] = await sql`
        INSERT INTO tickets (account_id, conversation_id, status, is_bot_active, bot_state)
        VALUES (${ACCOUNT_ID}, ${conversation.id}, 'open', true, ${triggeredGlobalCommand ? chatbotRules.global_commands[content.trim().toLowerCase()] : 'start'})
        RETURNING id, status, is_bot_active, bot_state;
      `;
    } else {
      // Jika tiket masih open/pending/snoozed, cukup update waktunya
      if (!triggeredGlobalCommand) {
        if (ticket.status === 'snoozed') {
           await sql`UPDATE tickets SET status = 'open', updated_at = NOW() WHERE id = ${ticket.id}`;
           ticket.status = 'open';
        } else {
           await sql`UPDATE tickets SET updated_at = NOW() WHERE id = ${ticket.id}`;
        }
      }
    }

    // 4. Masukkan Pesan ke Tabel Messages (Tautkan ke conversation_id DAN ticket_id)
    const finalContent = data.participant_id 
      ? `[${data.participant_name || 'Member'}]: ${content}` 
      : content;

    const [msg] = await sql`
      INSERT INTO messages (
        account_id, conversation_id, ticket_id, sender_type, sender_id, 
        content, message_type, status, created_at
      ) VALUES (
        ${ACCOUNT_ID}, ${conversation.id}, ${ticket.id}, 
        ${data.is_host_echo ? 'User' : 'Contact'}, 
        ${data.is_host_echo ? null : contact.id}, 
        ${finalContent}, 
        ${data.is_host_echo ? 'outgoing' : 'incoming'}, 
        'delivered', 
        to_timestamp(${timestamp})
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

    // 5. Evaluasi Chatbot
    if (!data.is_host_echo && ticket.is_bot_active && chatbotRules && chatbotRules.states) {
      const userText = content.trim();
      let targetNode = null;
      let targetNodeKey = null;

      if (triggeredGlobalCommand) {
        targetNodeKey = chatbotRules.global_commands[userText.toLowerCase()];
        targetNode = chatbotRules.states[targetNodeKey];
      } else {
        const currentState = chatbotRules.states[ticket.bot_state];
        if (currentState) {
          if (currentState.options) {
            if (currentState.options[userText]) {
              targetNodeKey = currentState.options[userText];
            } else if (currentState.options['*']) {
              targetNodeKey = currentState.options['*'];
            } else if (currentState.fallback) {
              targetNodeKey = currentState.fallback;
            }
          } else if (currentState.fallback) {
            targetNodeKey = currentState.fallback;
          }
          if (targetNodeKey) targetNode = chatbotRules.states[targetNodeKey];
        }
      }

      if (targetNode) {
        let newBotActive = true;
        let memory: Record<string, any> = {};

        // Fungsi bantu untuk mem-parsing variabel dinamis seperti {{user_input}} atau {{api_A.status}}
        const interpolateText = (text: string) => {
          let parsed = text.replace(/{{user_input}}/g, userText);
          parsed = parsed.replace(/{{phone_number}}/g, sourceJid.split('@')[0]);
          parsed = parsed.replace(/{{contact_name}}/g, displayName);
          
          // Mengganti variabel dari memory (misal: {{api_A.status}})
          const memMatches = parsed.match(/{{([a-zA-Z0-9_.]+?)}}/g);
          if (memMatches) {
            memMatches.forEach(match => {
              const path = match.replace(/[{}]/g, '').split('.');
              let val: any = memory;
              for (const p of path) {
                if (val !== undefined && val !== null) val = val[p];
              }
              if (val !== undefined && typeof val !== 'object') {
                parsed = parsed.replace(match, String(val));
              }
            });
          }
          return parsed;
        };

        const executeStep = async (step: any): Promise<boolean> => {
           if (step.type === 'text' && step.content) {
              const finalBotText = interpolateText(step.content);
              const [botMsg] = await sql`
                INSERT INTO messages (account_id, conversation_id, sender_type, sender_id, content, message_type, status)
                VALUES (${ACCOUNT_ID}, ${conversation.id}, 'System', NULL, ${finalBotText}, 'outgoing', 'sent')
                RETURNING *;
              `;
              await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: botMsg }));
              const payload: SendMessagePayload = {
                event: 'message.send',
                data: {
                  internal_message_id: botMsg.id,
                  target_id: sourceJid,
                  content: finalBotText,
                  message_type: 'text'
                }
              };
              await redis.rpush(QUEUE_OUTGOING, JSON.stringify(payload));
              return true;
           } else if (step.type === 'api_call') {
              try {
                const apiUrl = interpolateText(step.url);
                const reqOptions: any = {
                  method: step.method || 'GET',
                  headers: step.headers || {}
                };
                
                if (step.body && (step.method === 'POST' || step.method === 'PUT')) {
                   // Interpolate body if it's stringified JSON, or traverse object
                   const bodyStr = JSON.stringify(step.body);
                   reqOptions.body = interpolateText(bodyStr);
                   if (!reqOptions.headers['Content-Type']) {
                     reqOptions.headers['Content-Type'] = 'application/json';
                   }
                }

                const apiResponse = await fetch(apiUrl, reqOptions);
                const responseData = await apiResponse.json();
                
                if (step.store_response_as) {
                  memory[step.store_response_as] = responseData;
                }

                let isSuccess = false;
                if (step.on_success && step.on_success.condition) {
                   try {
                     const conditionFunc = new Function('response', `return ${step.on_success.condition};`);
                     isSuccess = conditionFunc(responseData);
                   } catch (e) {
                     console.error('Condition eval error:', e);
                   }
                } else if (apiResponse.ok) {
                   isSuccess = true;
                }

                if (isSuccess && step.on_success && step.on_success.target_state) {
                   targetNodeKey = step.on_success.target_state;
                   return false; // Berhenti eksekusi sequence saat ini dan melompat ke state baru
                } else if (!isSuccess && step.on_failure) {
                   targetNodeKey = step.on_failure.target_state;
                   return false; // Berhenti eksekusi sequence dan melompat ke state failure
                }
                return true; // Lanjutkan ke step berikutnya

              } catch (apiErr) {
                console.error('Chatbot API call failed:', apiErr);
                if (step.on_failure) {
                   targetNodeKey = step.on_failure.target_state;
                   return false; // Berhenti eksekusi
                }
                return true; // Jika tidak ada penanganan error, lanjut saja
              }
           }
           return true;
        };

        // Eksekusi Array Steps
        if (targetNode.steps && Array.isArray(targetNode.steps)) {
           for (const step of targetNode.steps) {
              const shouldContinue = await executeStep(step);
              if (!shouldContinue) {
                 // Terjadi lompatan state dinamis dari hasil API
                 break;
              }
           }
        } else if (targetNode.text) {
           // Backward compatibility dengan format lama
           await executeStep({ type: 'text', content: targetNode.text });
           
           if (targetNode.api_call) {
             const shouldContinue = await executeStep({ type: 'api_call', ...targetNode.api_call });
           }
        }

        if (targetNode.action === 'assign_agent') {
          newBotActive = false;
        } else if (targetNodeKey !== ticket.bot_state && chatbotRules.states[targetNodeKey]?.action === 'assign_agent') {
          // Cek jika lompatan state ternyata adalah transfer agent
          newBotActive = false;
        }

        // Update state di DB
        if (targetNodeKey !== ticket.bot_state || !newBotActive) {
          await sql`
            UPDATE tickets 
            SET bot_state = ${targetNodeKey}, is_bot_active = ${newBotActive}, updated_at = NOW()
            WHERE id = ${ticket.id}
          `;
        }
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

    // Join dengan account_users untuk mendapatkan role
    const [user] = await sql`
      SELECT u.id, u.name, u.email, u.password_hash, au.role 
      FROM users u
      LEFT JOIN account_users au ON u.id = au.user_id AND au.account_id = 1
      WHERE u.email = ${email} 
      LIMIT 1
    `;

    if (!user) {
      return c.json({ error: 'Kredensial tidak valid' }, 401);
    }

    const isMatch = await Bun.password.verify(password, user.password_hash);
    
    if (!isMatch) {
      return c.json({ error: 'Kredensial tidak valid' }, 401);
    }

    // Buat Token JWT dengan menyertakan role
    const payload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role || 'agent', // Default ke agent jika role null
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 // 24 Jam
    };
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    const token = await sign(payload, secret);

    return c.json({ 
      success: true, 
      token, 
      user: { id: user.id, name: user.name, email: user.email, role: user.role || 'agent' } 
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Terjadi kesalahan pada server' }, 500);
  }
});

// === MIDDLEWARE JWT (PROTECT ROUTES BELOW) ===
const jwtMiddleware = jwt({ secret: process.env.JWT_SECRET || 'fallback_secret', alg: 'HS256' });
app.use('/api/conversations/*', jwtMiddleware);
app.use('/api/conversations', jwtMiddleware);
app.use('/api/messages/*', jwtMiddleware);
app.use('/api/analytics', jwtMiddleware);
app.use('/api/canned-responses/*', jwtMiddleware);
app.use('/api/canned-responses', jwtMiddleware);
app.use('/api/contacts/*', jwtMiddleware);
app.use('/api/contacts', jwtMiddleware);

// Endpoint daftar semua kontak (CRM) dengan pencarian
app.get('/api/contacts', async (c) => {
  try {
    const search = c.req.query('q') || '';
    
    // Cari kontak dan hitung total tiketnya
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
      WHERE c.account_id = 1 AND (c.name ILIKE ${`%${search}%`} OR c.phone_number ILIKE ${`%${search}%`})
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

// Endpoint update data contact
app.patch('/api/contacts/:id', async (c) => {
  const contactId = c.req.param('id');
  try {
    const body = await c.req.json();
    const { name, email } = body;

    const [updatedContact] = await sql`
      UPDATE contacts 
      SET name = ${name}, email = ${email}, updated_at = NOW() 
      WHERE id = ${contactId} AND account_id = 1
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

// Ambil semua percakapan aktif untuk sidebar
app.get('/api/conversations', async (c) => {
  try {
    const activeTab = c.req.query('tab') || 'unassigned'; // 'unassigned', 'mine', 'assigned', 'all'
    
    // Ambil ID agen yang sedang login dari JWT
    const jwtPayload = c.get('jwtPayload');
    const currentAgentId = jwtPayload?.id;

    const convs = await sql`
      WITH LatestTickets AS (
        SELECT DISTINCT ON (c.id)
          t.id, 
          t.status, 
          t.updated_at, 
          t.assignee_id,
          u.name as assignee_name,
          con.id as contact_id,
          con.name as contact_name, 
          con.email as contact_email,
          con.phone_number as contact_phone,
          (SELECT content FROM messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message
        FROM tickets t
        JOIN conversations c ON t.conversation_id = c.id
        JOIN contacts con ON c.contact_id = con.id
        LEFT JOIN users u ON t.assignee_id = u.id
        WHERE t.account_id = 1 
        AND (
          (${activeTab === 'unassigned'}::boolean = true AND t.status != 'resolved' AND t.assignee_id IS NULL) OR
          (${activeTab === 'mine'}::boolean = true AND t.status != 'resolved' AND t.assignee_id = ${currentAgentId}) OR
          (${activeTab === 'assigned'}::boolean = true AND t.status != 'resolved' AND t.assignee_id IS NOT NULL) OR
          (${activeTab === 'all'}::boolean = true)
        )
        ORDER BY c.id, t.updated_at DESC
      )
      SELECT * FROM LatestTickets
      ORDER BY updated_at DESC
    `;
    return c.json(convs);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Gagal mengambil daftar percakapan' }, 500);
  }
});

// Ambil riwayat pesan untuk percakapan tertentu
app.get('/api/conversations/:id/messages', async (c) => {
  const ticketId = c.req.param('id');
  try {
    // Mengambil pesan berdasarkan wadah abadi (conversation_id) dari tiket ini
    const messages = await sql`
      SELECT 
        m.*,
        COALESCE(
          json_agg(a.*) FILTER (WHERE a.id IS NOT NULL), 
          '[]'
        ) AS attachments
      FROM messages m
      LEFT JOIN attachments a ON m.id = a.message_id
      WHERE m.conversation_id = (SELECT conversation_id FROM tickets WHERE id = ${ticketId} LIMIT 1) 
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
    const jwtPayload = c.get('jwtPayload');
    const agentId = jwtPayload.id;

    const body = await c.req.json();
    const { target_id, content, conversation_id, account_id, media, is_private } = body;

    // Ambil conversation_id asli dan assignee_id dari tiket
    const [ticket] = await sql`SELECT conversation_id, assignee_id FROM tickets WHERE id = ${conversation_id} LIMIT 1`;
    if (!ticket) return c.json({ error: 'Tiket tidak ditemukan' }, 404);
    
    // Validasi keamanan: Pastikan tiket ini dipegang oleh agen yang sedang login
    if (ticket.assignee_id !== agentId) {
      return c.json({ error: 'Akses ditolak: Anda harus mengambil alih tiket ini terlebih dahulu.' }, 403);
    }

    const tDbStart = Date.now();
    const [msg] = await sql`
      INSERT INTO messages (
        account_id, conversation_id, ticket_id, sender_type, sender_id, 
        content, message_type, status, is_private
      ) VALUES (
        ${account_id || 1}, ${ticket.conversation_id}, ${conversation_id}, 'User', ${agentId}, 
        ${content || ''}, 'outgoing', 'sent', ${is_private || false}
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

    // Beritahu WA Adapter via Redis Queue HANYA JIKA BUKAN PRIVATE NOTE
    if (!is_private) {
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
    } else {
      console.log(`[DEBUG-LATENCY] (${Date.now()}) Pesan adalah Private Note, dilewati dari antrean Redis.`);
    }
    
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

    const [ticket] = await sql`
      UPDATE tickets 
      SET status = ${status}, updated_at = NOW() 
      WHERE id = ${conversationId}
      RETURNING *;
    `;

    if (!ticket) {
      return c.json({ error: 'Tiket tidak ditemukan' }, 404);
    }

    // Dual-write: Catat ke conversation_events dan pesan sistem
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

// Endpoint untuk mengambil alih tiket (Assign to me)
app.patch('/api/conversations/:id/assign', async (c) => {
  const conversationId = c.req.param('id');
  try {
    const jwtPayload = c.get('jwtPayload');
    const agentId = jwtPayload.id;
    const agentName = jwtPayload.name;

    const [ticket] = await sql`
      UPDATE tickets 
      SET assignee_id = ${agentId}, updated_at = NOW() 
      WHERE id = ${conversationId} AND assignee_id IS NULL
      RETURNING *;
    `;

    if (!ticket) {
      // Cek apakah memang tidak ketemu atau sudah diambil orang lain
      const [existing] = await sql`SELECT assignee_id FROM tickets WHERE id = ${conversationId}`;
      if (!existing) return c.json({ error: 'Tiket tidak ditemukan' }, 404);
      if (existing.assignee_id !== null) return c.json({ error: 'Tiket sudah diambil agen lain' }, 400);
    }

    // Dual-write: Catat ke conversation_events dan pesan sistem
    await sql`
      INSERT INTO conversation_events (account_id, conversation_id, ticket_id, actor_type, actor_id, event_type, event_data)
      VALUES (${ticket.account_id}, ${ticket.conversation_id}, ${ticket.id}, 'User', ${agentId}, 'assigned', ${sql.json({ new_assignee_id: agentId })});
    `;
    
    const [sysMsg] = await sql`
      INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, sender_id, content, message_type, status)
      VALUES (${ticket.account_id}, ${ticket.conversation_id}, ${ticket.id}, 'System', NULL, ${`Tiket #TKT-${String(ticket.id).padStart(4, '0')} diambil alih oleh ${agentName}`}, 'template', 'sent')
      RETURNING *;
    `;
    await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: sysMsg }));

    return c.json({ success: true, data: ticket });
  } catch (error) {
    console.error('Error assign ticket:', error);
    return c.json({ success: false, error: 'Gagal mengambil tiket' }, 500);
  }
});

// Endpoint untuk melepas tiket (Unassign)
app.patch('/api/conversations/:id/unassign', async (c) => {
  const conversationId = c.req.param('id');
  try {
    const jwtPayload = c.get('jwtPayload');
    const agentId = jwtPayload.id;
    const agentName = jwtPayload.name;

    const [ticket] = await sql`
      UPDATE tickets 
      SET assignee_id = NULL, updated_at = NOW() 
      WHERE id = ${conversationId} AND assignee_id = ${agentId}
      RETURNING *;
    `;

    if (!ticket) {
      return c.json({ error: 'Tiket tidak ditemukan atau tidak dipegang oleh Anda' }, 400);
    }

    // Dual-write: Catat ke conversation_events dan pesan sistem
    await sql`
      INSERT INTO conversation_events (account_id, conversation_id, ticket_id, actor_type, actor_id, event_type, event_data)
      VALUES (${ticket.account_id}, ${ticket.conversation_id}, ${ticket.id}, 'User', ${agentId}, 'unassigned', ${sql.json({ old_assignee_id: agentId })});
    `;
    
    const [sysMsg] = await sql`
      INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, sender_id, content, message_type, status)
      VALUES (${ticket.account_id}, ${ticket.conversation_id}, ${ticket.id}, 'System', NULL, ${`Tiket #TKT-${String(ticket.id).padStart(4, '0')} dilepas oleh ${agentName}`}, 'template', 'sent')
      RETURNING *;
    `;
    await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: sysMsg }));

    return c.json({ success: true, data: ticket });
  } catch (error) {
    console.error('Error unassign ticket:', error);
    return c.json({ success: false, error: 'Gagal melepas tiket' }, 500);
  }
});

// Endpoint untuk mengambil daftar Canned Responses
app.get('/api/canned-responses', async (c) => {
  try {
    const responses = await sql`
      SELECT id, short_code, content 
      FROM canned_responses 
      WHERE account_id = 1 
      ORDER BY short_code ASC
    `;
    return c.json(responses);
  } catch (error) {
    console.error('Error fetch canned responses:', error);
    return c.json({ error: 'Gagal mengambil balasan cepat' }, 500);
  }
});

// Endpoint untuk menambah Canned Response
app.post('/api/canned-responses', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload');
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const body = await c.req.json();
    const { short_code, content } = body;
    const [response] = await sql`
      INSERT INTO canned_responses (account_id, short_code, content)
      VALUES (1, ${short_code}, ${content})
      RETURNING *
    `;
    return c.json({ success: true, data: response });
  } catch (error) {
    console.error('Error create canned response:', error);
    return c.json({ error: 'Gagal menambah balasan cepat' }, 500);
  }
});

// Endpoint untuk mengupdate Canned Response
app.put('/api/canned-responses/:id', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload');
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const id = c.req.param('id');
    const body = await c.req.json();
    const { short_code, content } = body;
    const [response] = await sql`
      UPDATE canned_responses
      SET short_code = ${short_code}, content = ${content}
      WHERE id = ${id} AND account_id = 1
      RETURNING *
    `;
    return c.json({ success: true, data: response });
  } catch (error) {
    console.error('Error update canned response:', error);
    return c.json({ error: 'Gagal mengubah balasan cepat' }, 500);
  }
});

// Endpoint untuk menghapus Canned Response
app.delete('/api/canned-responses/:id', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload');
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const id = c.req.param('id');
    await sql`DELETE FROM canned_responses WHERE id = ${id} AND account_id = 1`;
    return c.json({ success: true });
  } catch (error) {
    console.error('Error delete canned response:', error);
    return c.json({ error: 'Gagal menghapus balasan cepat' }, 500);
  }
});

// Endpoint untuk Dasbor Analitik
app.get('/api/analytics', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload');
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    // 1. Total Tiket Masuk Hari Ini
    const [totalIncoming] = await sql`
      SELECT COUNT(DISTINCT ticket_id) as count 
      FROM messages 
      WHERE sender_type = 'Contact' 
      AND created_at >= CURRENT_DATE
    `;

    // 2. Total Tiket Diselesaikan Hari Ini
    const [totalResolved] = await sql`
      SELECT COUNT(*) as count 
      FROM conversation_events 
      WHERE event_type = 'status_changed' 
      AND event_data->>'new_status' = 'resolved'
      AND created_at >= CURRENT_DATE
    `;

    // 3. Status Tiket Saat Ini
    const statusCounts = await sql`
      SELECT status, COUNT(*) as count 
      FROM tickets 
      WHERE account_id = 1
      GROUP BY status
    `;

    // 4. Performa Agen (Jumlah tiket yang di-resolve hari ini per agen)
    const agentPerformance = await sql`
      SELECT 
        u.name, 
        COUNT(ce.id) as resolved_count
      FROM conversation_events ce
      JOIN users u ON ce.actor_id = u.id
      WHERE ce.event_type = 'status_changed' 
        AND ce.event_data->>'new_status' = 'resolved'
        AND ce.actor_type = 'User'
        AND ce.created_at >= CURRENT_DATE
      GROUP BY u.id, u.name
      ORDER BY resolved_count DESC
    `;

    return c.json({
      success: true,
      data: {
        today: {
          incoming_tickets: parseInt(totalIncoming?.count || '0'),
          resolved_tickets: parseInt(totalResolved?.count || '0')
        },
        current_status: statusCounts || [],
        agent_performance: agentPerformance || []
      }
    });
  } catch (error) {
    console.error('Error fetch analytics:', error);
    return c.json({ error: 'Gagal mengambil data analitik' }, 500);
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