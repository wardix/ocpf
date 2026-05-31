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

// Konfigurasi Inboxes
// Format JSON: [{"id": 1, "dir": "auth_info_1"}, {"id": 2, "dir": "auth_info_2"}]
const INBOXES = process.env.INBOXES 
  ? JSON.parse(process.env.INBOXES) 
  : [{ id: parseInt(process.env.INBOX_ID) || 1, dir: process.env.SESSION_DIR || 'auth_info_baileys' }];

// Simpan instance socket berdasarkan inbox_id
const activeSockets = new Map();

// Cache untuk menyimpan ID pesan yang dikirim dari Dashboard agar tidak diproses ganda
const sentCache = new Set();

async function startBaileysForInbox(inboxId, sessionDir) {
  // Ambil versi WhatsApp terbaru secara dinamis agar tidak kena status 405 (Method Not Allowed)
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[Inbox ${inboxId}] Menggunakan WA Version: ${version.join('.')}, isLatest: ${isLatest}`);
  console.log(`[Inbox ${inboxId}] Menjalankan sesi di folder: ${sessionDir}`);

  // Menggunakan folder dinamis untuk menyimpan sesi login QR Code
  const { state, saveCreds } = await useMultiFileAuthState(path.join(process.cwd(), sessionDir));

  const sock = createWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), 
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
  });

  // Simpan ke memory
  activeSockets.set(inboxId, sock);

  // Listener: Perubahan Koneksi
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`[Inbox ${inboxId}] QR Code baru tersedia, silakan scan:`);
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorReason = lastDisconnect?.error;
      
      console.log(`[Inbox ${inboxId}] Koneksi terputus! Status: ${statusCode}, Alasan:`, errorReason);

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log(`[Inbox ${inboxId}] Mencoba menyambung ulang dalam 5 detik...`);
        setTimeout(() => startBaileysForInbox(inboxId, sessionDir), 5000); 
      } else {
        activeSockets.delete(inboxId);
      }
    } else if (connection === 'open') {
      console.log(`[Inbox ${inboxId}] WhatsApp Adapter Berhasil Terhubung! ✅`);
    }
  });

  // Simpan kredensial jika ada perubahan
  sock.ev.on('creds.update', saveCreds);

  // 1. DARI WA ADAPTER -> KE REDIS (Pesan Masuk)
  // =========================================================================
  sock.ev.on('messages.upsert', async (m) => {
    console.log(`[Inbox ${inboxId}] Menerima batch ${m.messages.length} pesan.`);
    for (const msg of m.messages) {
      try {
        if (
          !msg.message || 
          msg.message.protocolMessage || 
          msg.category === 'peer'
        ) continue;

        let isHostEcho = false;
        if (msg.key.fromMe) {
          if (sentCache.has(msg.key.id)) {
            console.log(`[Inbox ${inboxId}][DEBUG-ECHO] Mengabaikan pesan dari cache (Dashboard): ${msg.key.id}`);
            continue;
          }
          isHostEcho = true;
          console.log(`[Inbox ${inboxId}][DEBUG-ECHO] Terdeteksi pesan manual dari HP Host: ${msg.key.id}`);
        }

        // Unwrap ViewOnce
        let actualMessage = msg.message;
        if (actualMessage.viewOnceMessageV2) {
          actualMessage = actualMessage.viewOnceMessageV2.message;
        } else if (actualMessage.viewOnceMessage) {
          actualMessage = actualMessage.viewOnceMessage.message;
        } else if (actualMessage.ephemeralMessage) {
          actualMessage = actualMessage.ephemeralMessage.message;
        }

        let textContent = actualMessage.conversation || actualMessage.extendedTextMessage?.text || '';
        let fullJid = msg.key.remoteJid;
        
        // Normalisasi JID
        if (fullJid.endsWith('@lid') && msg.key.remoteJidAlt?.endsWith('@s.whatsapp.net')) {
          fullJid = msg.key.remoteJidAlt;
        }

        const isGroup = fullJid.endsWith('@g.us');
        const sourceId = fullJid.split('@')[0];
      
        let displayName = msg.pushName || 'Unknown';

        if (isGroup) {
          try {
            const groupMetadata = await sock.groupMetadata(fullJid);
            displayName = groupMetadata.subject || 'WhatsApp Group';
          } catch (e) {
            displayName = 'WhatsApp Group';
          }
        }

        const participantId = isGroup ? msg.key.participant : null;
        console.log(`[Inbox ${inboxId}] Pesan Masuk Dari: ${displayName} (${fullJid})`);

        // Media & Type parsing
        let mediaPayload = undefined;
        let finalMessageType = 'text';
        const messageTypeKey = Object.keys(actualMessage || {}).filter(k => k !== 'messageContextInfo')[0];
        
        if (['imageMessage', 'documentMessage', 'audioMessage', 'videoMessage', 'stickerMessage'].includes(messageTypeKey)) {
          finalMessageType = messageTypeKey.replace('Message', '');
          try {
            console.log(`[Inbox ${inboxId}] Mengunduh media (${messageTypeKey})...`);
            const buffer = await downloadMediaMessage(
              msg, // Pass original msg
              'buffer',
              { },
              { 
                logger: pino({ level: 'silent' }),
                reuploadRequest: sock.updateMediaMessage
              }
            );
            
            const mediaMsg = actualMessage[messageTypeKey];
            mediaPayload = {
              mimetype: mediaMsg.mimetype || (messageTypeKey === 'stickerMessage' ? 'image/webp' : 'application/octet-stream'),
              data_base64: buffer.toString('base64'),
              filename: mediaMsg.fileName || (messageTypeKey === 'stickerMessage' ? 'sticker.webp' : undefined)
            };
            
            if (mediaMsg.caption) textContent = mediaMsg.caption;
          } catch (err) {
            console.error(`[Inbox ${inboxId}] Gagal mengunduh media dari WA:`, err);
            textContent = `[Gagal mengunduh ${finalMessageType}]`;
          }
        } else if (messageTypeKey === 'locationMessage' || messageTypeKey === 'liveLocationMessage') {
          finalMessageType = 'location';
          const loc = actualMessage[messageTypeKey];
          textContent = `📍 [Lokasi]: https://maps.google.com/?q=${loc.degreesLatitude},${loc.degreesLongitude}`;
        } else if (messageTypeKey === 'contactMessage') {
          finalMessageType = 'contact';
          const contact = actualMessage[messageTypeKey];
          textContent = `👤 [Kontak]: ${contact.displayName}\n${contact.vcard}`;
        } else if (messageTypeKey === 'reactionMessage') {
          finalMessageType = 'reaction';
          const reaction = actualMessage[messageTypeKey];
          textContent = `[Reaksi: ${reaction.text}]`;
        } else if (messageTypeKey === 'pollCreationMessage' || messageTypeKey === 'pollCreationMessageV3') {
          finalMessageType = 'poll';
          const poll = actualMessage[messageTypeKey];
          textContent = `📊 [Polling]: ${poll.name}\n${poll.options?.map(o => '- ' + o.optionName).join('\n') || ''}`;
        } else if (!textContent && messageTypeKey) {
           textContent = `[Tipe pesan tidak didukung: ${messageTypeKey}]`;
           finalMessageType = 'unknown';
           
           // Dump for debugging per GEMINI.md
           const fs = require('fs');
           const path = require('path');
           const dumpDir = path.join(process.cwd(), 'message_dumps');
           if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
           const dumpPath = path.join(dumpDir, `${Date.now()}_${msg.key.id}.json`);
           fs.writeFileSync(dumpPath, JSON.stringify(msg, null, 2));
           console.log(`[Inbox ${inboxId}] Tipe pesan tidak didukung (${messageTypeKey}), raw dump disimpan di ${dumpPath}`);
        }

        const payload = {
          event: 'message.incoming',
          data: {
            inbox_id: inboxId,
            source_id: sourceId,
            source_jid: fullJid, 
            push_name: displayName,
            content: textContent,
            message_type: finalMessageType,
            wa_message_id: msg.key.id,
            timestamp: msg.messageTimestamp,
            participant_id: participantId,
            participant_name: isGroup ? msg.pushName : null,
            is_host_echo: isHostEcho,
            media: mediaPayload 
          }
        };

        await redis.rpush(QUEUE_INCOMING, JSON.stringify(payload));
      } catch (error) {
        console.error(`[Inbox ${inboxId}] Error memproses satu pesan masuk:`, error);
      }
    }
  });
}

// =========================================================================
// 2. DARI REDIS -> KE WA ADAPTER (Mendengarkan Perintah Kirim Pesan)
// =========================================================================
async function listenForOutgoingMessages() {
  const queues = INBOXES.map(i => `queue:outgoing_messages:inbox_${i.id}`);
  console.log(`\nMenunggu perintah kirim pesan di antrean: ${queues.join(', ')}`);

  while (true) {
    try {
      // brpop menerima array queues. 0 berarti block selamanya sampai ada pesan.
      const result = await redisSub.brpop(...queues, 0);
      
      if (result) {
        const [queueName, messageDataString] = result;
        const targetInboxId = parseInt(queueName.split('_').pop());
        const payload = JSON.parse(messageDataString);

        if (payload.event === 'message.send') {
          const poppedAt = Date.now();
          const queuedAt = payload._queued_at || poppedAt;
          const redisLatency = poppedAt - queuedAt;
          
          const { target_id, content, media } = payload.data;
          console.log(`\n[DEBUG-LATENCY] (${poppedAt}) [Inbox ${targetInboxId}] Mengambil antrean kirim pesan (Latency Antrean Redis: ${redisLatency}ms)`);
          
          const sock = activeSockets.get(targetInboxId);
          if (!sock) {
            console.error(`[Inbox ${targetInboxId}] Socket tidak ditemukan atau belum siap! Mengabaikan pesan.`);
            continue;
          }

          console.log(`[Kirim Pesan] [Inbox ${targetInboxId}] Ke: ${target_id} - Mengirim via Baileys...`);
          const sendStart = Date.now();
          
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

          const sentMsg = await sock.sendMessage(target_id, waMessage);
          
          if (sentMsg?.key?.id) {
            sentCache.add(sentMsg.key.id);
            setTimeout(() => sentCache.delete(sentMsg.key.id), 60000);
          }
          
          const sendEnd = Date.now();
          console.log(`-> [Inbox ${targetInboxId}] Pesan berhasil dikirim! (Proses: ${sendEnd - sendStart}ms)`);
        }
      }
    } catch (err) {
      console.error('Error saat mendengarkan antrean kirim pesan:', err);
    }
  }
}

// =========================================================================
// START SERVICE (SESSION MANAGER)
// =========================================================================
console.log('Memulai Multi-Session WhatsApp Adapter Service (Baileys)...');

// Inisiasi semua sockets
for (const inbox of INBOXES) {
  startBaileysForInbox(inbox.id, inbox.dir);
}

// Mulai satu central listener untuk semua queue
listenForOutgoingMessages();