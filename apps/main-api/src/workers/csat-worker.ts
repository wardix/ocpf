import { sql } from '../config/database';
import { redis, PUB_SUB_CH } from '../config/redis';

export function startCSATWorker() {
  console.log('[CSAT Worker] 📊 Worker dimulai (interval: 10s)');

  setInterval(async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      // Ambil semua job yang target eksekusinya <= waktu sekarang
      const jobs = await redis.zrangebyscore('queue:csat_surveys', 0, now);

      if (jobs.length > 0) {
        console.log(`[CSAT Worker] Memproses ${jobs.length} survei tertunda...`);
      }

      for (const jobString of jobs) {
        try {
          const jobData = JSON.parse(jobString);
          const { ticket_id, inbox_id, account_id, conversation_id } = jobData;

          // Hapus langsung dari Redis agar tidak dieksekusi ganda jika terjadi crash
          await redis.zrem('queue:csat_surveys', jobString);

          // Gunakan transaksi agar penandaan dan pengiriman konsisten
          await sql.begin(async (tx) => {
            // Cek status tiket terakhir
            const [ticket] = await tx`
              SELECT id, status, csat_survey_sent 
              FROM tickets 
              WHERE id = ${ticket_id} AND account_id = ${account_id}
              LIMIT 1
            `;

            // Kirim HANYA jika tiket masih berstatus 'resolved' dan belum dikirimi survey
            if (ticket && ticket.status === 'resolved' && !ticket.csat_survey_sent) {
              // Ambil konfigurasi pesan survei
              const [settings] = await tx`
                SELECT csat_message 
                FROM inbox_settings 
                WHERE inbox_id = ${inbox_id} AND account_id = ${account_id} 
                LIMIT 1
              `;

              const csatMessageText = settings?.csat_message || 
                'Terima kasih telah menghubungi kami! Bagaimana penilaian Anda terhadap layanan kami? Reply 1-5 (1=Sangat Buruk, 5=Sangat Baik)';

              // Cari nomor tujuan contact
              const [contact] = await tx`
                SELECT c.phone_number 
                FROM contacts c
                JOIN conversations conv ON conv.contact_id = c.id
                WHERE conv.id = ${conversation_id} AND conv.account_id = ${account_id} AND c.deleted_at IS NULL
                LIMIT 1
              `;

              if (contact && contact.phone_number) {
                // 1. Tandai tiket bahwa survei telah dikirim
                await tx`
                  UPDATE tickets 
                  SET csat_survey_sent = true, updated_at = NOW() 
                  WHERE id = ${ticket_id}
                `;

                // 2. Simpan pesan survei ke tabel messages
                const [insertedMsg] = await tx`
                  INSERT INTO messages (
                    account_id, conversation_id, ticket_id, sender_type, sender_id, 
                    content, message_type, status
                  ) VALUES (
                    ${account_id}, ${conversation_id}, ${ticket_id}, 'System', NULL, 
                    ${csatMessageText}, 'outgoing', 'sent'
                  )
                  RETURNING *;
                `;

                // 3. Masukkan ke antrean kirim WA (queue:outgoing_messages)
                const outgoingPayload = {
                  event: 'message.send',
                  data: {
                    inbox_id: Number(inbox_id),
                    internal_message_id: Number(insertedMsg.id),
                    target_id: contact.phone_number,
                    content: csatMessageText,
                    message_type: 'text'
                  }
                };

                const targetQueue = `queue:outgoing_messages:inbox_${inbox_id}`;
                await redis.rpush(targetQueue, JSON.stringify({ ...outgoingPayload, _queued_at: Date.now() }));

                // 4. Publikasikan via Pub/Sub agar frontend menampilkan gelembung pesan survei secara real-time
                await redis.publish(PUB_SUB_CH, JSON.stringify({
                  event: 'message.new',
                  data: insertedMsg
                }));

                console.log(`[CSAT Worker] Sukses mengirim survei CSAT untuk tiket #${ticket_id} ke ${contact.phone_number}`);
              } else {
                console.warn(`[CSAT Worker] Tidak menemukan phone_number untuk percakapan #${conversation_id}`);
              }
            } else {
              console.log(`[CSAT Worker] Lewati kirim survei tiket #${ticket_id}. Status: ${ticket?.status}, Sent: ${ticket?.csat_survey_sent}`);
            }
          });
        } catch (jobErr) {
          console.error('[CSAT Worker] Gagal memproses data job:', jobErr, jobString);
        }
      }
    } catch (error) {
      console.error('[CSAT Worker] Polling Error:', error);
    }
  }, 10_000); // Polling setiap 10 detik
}
