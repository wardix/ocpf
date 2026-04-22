// apps/wa-adapter/src/index.js
import { 
  default as makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion 
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import Redis from 'ioredis';
import path from 'path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs/promises';

// Jika makeWASocket adalah undefined (masalah ESM), coba ambil dari .default
const createWASocket = typeof makeWASocket === 'function' ? makeWASocket : makeWASocket.default;

// Koneksi ke Redis (untuk Queue & Pub/Sub)
const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
});
// Koneksi Redis terpisah untuk mode 'Subscriber' (mendengarkan perintah dari Main API)
const redisSub = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
});

const QUEUE_INCOMING = 'queue:incoming_messages';
const QUEUE_OUTGOING = 'queue:outgoing_messages';

async function startBaileys() {
  // Ambil versi WhatsApp terbaru secara dinamis agar tidak kena status 405 (Method Not Allowed)
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Menggunakan WA Version: ${version.join('.')}, isLatest: ${isLatest}`);

  // Menggunakan folder 'auth_info_baileys' untuk menyimpan sesi login QR Code
  const { state, saveCreds } = await useMultiFileAuthState(path.join(process.cwd(), 'auth_info_baileys'));

  const sock = createWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), 
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
  });

  // Listener: Perubahan Koneksi
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('QR Code baru tersedia, silakan scan:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorReason = lastDisconnect?.error;
      
      console.log(`Koneksi terputus! Status: ${statusCode}, Alasan:`, errorReason);

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log('Mencoba menyambung ulang dalam 5 detik...');
        setTimeout(() => startBaileys(), 5000); 
      }
    } else if (connection === 'open') {
      console.log('WhatsApp Adapter Berhasil Terhubung! ✅');
    }
  });

  // Simpan kredensial jika ada perubahan (agar tidak usah scan QR terus)
  sock.ev.on('creds.update', saveCreds);

  // 1. DARI WA ADAPTER -> KE REDIS (Pesan Masuk)
  // =========================================================================
  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      
      // -- FITUR DUMP PESAN MENTAH UNTUK DEBUGGING --
      // Simpan payload mentah dari Baileys ke file JSON
      const dumpDir = path.join(process.cwd(), 'message_dumps');
      const timestampDump = Date.now();
      const msgId = msg?.key?.id || 'unknown';
      const dumpFilename = path.join(dumpDir, `msg-${timestampDump}-${msgId}.json`);
      
      // Tulis file ke background tanpa await (fire and forget) agar tidak memblokir antrean utama
      fs.writeFile(dumpFilename, JSON.stringify(m, null, 2))
        .catch(err => console.error('Gagal mem-dump pesan:', err));
      // ----------------------------------------------

      if (!msg.message || msg.key.fromMe) return;

      const textContent = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      
      let fullJid = msg.key.remoteJid;
      
      // -- NORMALISASI JID UNTUK MULTI-DEVICE --
      // Jika pesan berasal dari perangkat pendamping (seperti WA Desktop),
      // WA menggunakan @lid. Kita prioritaskan @s.whatsapp.net dari remoteJidAlt 
      // agar percakapan tetap menyatu (tidak terpecah) di database.
      if (fullJid.endsWith('@lid') && msg.key.remoteJidAlt?.endsWith('@s.whatsapp.net')) {
        fullJid = msg.key.remoteJidAlt;
      }
      // ----------------------------------------

      const isGroup = fullJid.endsWith('@g.us');
      
      // Ambil angka depan saja untuk ID
      const sourceId = fullJid.split('@')[0];
    
    let displayName = msg.pushName || 'Unknown';

    // Jika Grup, coba ambil nama Grup dari Metadata
    if (isGroup) {
      try {
        const groupMetadata = await sock.groupMetadata(fullJid);
        displayName = groupMetadata.subject || 'WhatsApp Group';
      } catch (e) {
        displayName = 'WhatsApp Group';
      }
    }

    const participantId = isGroup ? msg.key.participant : null;

    console.log(`[Pesan Masuk] Dari: ${displayName} (${fullJid})`);

    const payload = {
      event: 'message.incoming',
      data: {
        source_id: sourceId,
        source_jid: fullJid, // Kirim alamat lengkap (format asli WA)
        push_name: displayName,
        content: textContent,
        message_type: 'text',
        wa_message_id: msg.key.id,
        timestamp: msg.messageTimestamp,
        participant_id: participantId,
        participant_name: isGroup ? msg.pushName : null
      }
    };

    // Lempar ke Antrean Redis agar Main API (Bun) memprosesnya
    await redis.rpush(QUEUE_INCOMING, JSON.stringify(payload));
    console.log('-> Berhasil dilempar ke antrean Redis (QUEUE_INCOMING).');
    } catch (error) {
      console.error('Error saat memproses pesan masuk:', error);
    }
  });

  // =========================================================================
  // 2. DARI REDIS -> KE WA ADAPTER (Mendengarkan Perintah Kirim Pesan)
  // =========================================================================
  // Menggunakan metode BRPOP (Blocking Right Pop) agar Node.js terus mendengarkan antrean tanpa polling berlebihan
  async function listenForOutgoingMessages() {
    while (true) {
      try {
        // Ambil elemen pertama dari antrean (block selama 0 detik/selamanya jika kosong)
        const result = await redisSub.brpop(QUEUE_OUTGOING, 0);
        if (result) {
          const [queueName, messageDataString] = result;
          const payload = JSON.parse(messageDataString);

          if (payload.event === 'message.send') {
            const poppedAt = Date.now();
            const queuedAt = payload._queued_at || poppedAt;
            const redisLatency = poppedAt - queuedAt;
            
            const { target_id, content } = payload.data;
            console.log(`\n[DEBUG-LATENCY] (${poppedAt}) Mengambil antrean kirim pesan (Latency Antrean Redis: ${redisLatency}ms)`);
            console.log(`[Kirim Pesan] Ke: ${target_id} - Mengirim via Baileys...`);
            
            const sendStart = Date.now();
            // Kirim pesan melalui Socket WhatsApp
            await sock.sendMessage(target_id, { text: content });
            const sendEnd = Date.now();
            
            console.log(`-> Pesan berhasil dikirim! [DEBUG-LATENCY] (Proses pengiriman WA memakan waktu: ${sendEnd - sendStart}ms)`);
          }
        }
      } catch (err) {
        console.error('Error saat mendengarkan antrean kirim pesan:', err);
      }
    }
  }

  // Mulai mendengarkan antrean pesan keluar di background
  listenForOutgoingMessages();
}

// Jalankan Service
console.log('Memulai WhatsApp Adapter Service (Baileys)...');
startBaileys();
