// apps/wa-adapter/src/index.js
import { 
  default as makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage
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
      // ... (kode dump tetap ada)
      
      // ABAIKAN PESAN JIKA:
      // 1. Tidak ada objek message
      // 2. Pesan bertipe protocolMessage (sync kunci, hapus pesan, dll)
      // 3. Kategori pesan adalah 'peer' (internal sinkronisasi antar perangkat)
      if (
        !msg.message || 
        msg.message.protocolMessage || 
        msg.category === 'peer'
      ) return;

      let isHostEcho = false;
      if (msg.key.fromMe) {
        if (sentCache.has(msg.key.id)) {
          // Ini adalah pantulan (echo) dari pesan yang dikirim Dashboard. Abaikan.
          return;
        }
        // Jika tidak ada di cache, berarti dikirim manual langsung dari HP Host!
        isHostEcho = true;
      }

      let textContent = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      
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

    // -- DETEKSI DAN UNDUH MEDIA --
    let mediaPayload = undefined;
    let finalMessageType = 'text';
    
    // Ambil kunci pertama dari objek message (misal: 'imageMessage', 'documentMessage', 'conversation')
    const messageTypeKey = Object.keys(msg.message || {})[0];
    
    if (['imageMessage', 'documentMessage', 'audioMessage', 'videoMessage'].includes(messageTypeKey)) {
      finalMessageType = messageTypeKey.replace('Message', ''); // Menjadi 'image', 'document', dll
      try {
        console.log(`Mendeteksi lampiran media (${messageTypeKey}), sedang mengunduh...`);
        
        const buffer = await downloadMediaMessage(
          msg,
          'buffer',
          { },
          { 
            logger: pino({ level: 'silent' }),
            reuploadRequest: sock.updateMediaMessage
          }
        );
        
        const mediaMsg = msg.message[messageTypeKey];
        mediaPayload = {
          mimetype: mediaMsg.mimetype || 'application/octet-stream',
          data_base64: buffer.toString('base64'),
          filename: mediaMsg.fileName || undefined
        };
        
        // Jika ada caption pada gambar/dokumen, kita jadikan sebagai textContent
        if (mediaMsg.caption) {
          textContent = mediaMsg.caption;
        }
        
        console.log(`Media berhasil diunduh (${buffer.length} bytes).`);
      } catch (err) {
        console.error('Gagal mengunduh media dari WA:', err);
      }
    }

    const payload = {
      event: 'message.incoming',
      data: {
        source_id: sourceId,
        source_jid: fullJid, 
        push_name: displayName,
        content: textContent,
        message_type: finalMessageType, // 'text', 'image', dll
        wa_message_id: msg.key.id,
        timestamp: msg.messageTimestamp,
        participant_id: participantId,
        participant_name: isGroup ? msg.pushName : null,
        media: mediaPayload // Tambahkan data base64 ke payload
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
            
            const { target_id, content, media } = payload.data;
            console.log(`\n[DEBUG-LATENCY] (${poppedAt}) Mengambil antrean kirim pesan (Latency Antrean Redis: ${redisLatency}ms)`);
            console.log(`[Kirim Pesan] Ke: ${target_id} - Mengirim via Baileys...`);
            
            const sendStart = Date.now();
            
            // Siapkan objek pesan
            let waMessage = {};
            if (media) {
              const buffer = Buffer.from(media.data_base64, 'base64');
              const isDocument = !media.mimetype.startsWith('image/') && !media.mimetype.startsWith('video/');
              
              if (isDocument) {
                waMessage = {
                  document: buffer,
                  mimetype: media.mimetype,
                  fileName: media.filename || 'document.bin',
                  caption: content || undefined
                };
              } else if (media.mimetype.startsWith('video/')) {
                waMessage = {
                  video: buffer,
                  mimetype: media.mimetype,
                  caption: content || undefined
                };
              } else {
                waMessage = {
                  image: buffer,
                  mimetype: media.mimetype,
                  caption: content || undefined
                };
              }
            } else {
              waMessage = { text: content };
            }

            // Kirim pesan melalui Socket WhatsApp
            const sentMsg = await sock.sendMessage(target_id, waMessage);
            
            if (sentMsg?.key?.id) {
              sentCache.add(sentMsg.key.id);
              // Hapus dari cache setelah 1 menit agar memori tidak penuh
              setTimeout(() => sentCache.delete(sentMsg.key.id), 60000);
            }
            
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
