import { sql } from '../config/database';
import { redis } from '../config/redis';

async function processScheduledMessages() {
  try {
    // We use a transaction and FOR UPDATE SKIP LOCKED to prevent multiple workers 
    // from processing the same scheduled messages concurrently.
    await sql.begin(async (tx: any) => {
      const messages = await tx`
        SELECT 
          sm.id, sm.account_id, sm.conversation_id, sm.ticket_id, sm.content, sm.media,
          c.inbox_id, c.contact_id, con.phone_number, sm.created_by
        FROM scheduled_messages sm
        JOIN conversations c ON sm.conversation_id = c.id
        JOIN contacts con ON c.contact_id = con.id
        WHERE sm.status = 'pending' AND sm.scheduled_at <= NOW()
        FOR UPDATE SKIP LOCKED
        LIMIT 50
      `;

      if (messages.length === 0) return;

      for (const msg of messages) {
        try {
          const [insertedMessage] = await tx`
            INSERT INTO messages (
              account_id, conversation_id, sender_type, sender_id, content, status
            ) VALUES (
              ${msg.account_id}, ${msg.conversation_id}, 'Agent', ${msg.created_by}, ${msg.content}, 'pending'
            ) RETURNING id, created_at, status
          `;

          // Update scheduled message status
          await tx`
            UPDATE scheduled_messages 
            SET status = 'sent', sent_at = NOW(), updated_at = NOW()
            WHERE id = ${msg.id}
          `;

          // Format payload for Redis queue
          const payload: import('@omnichannel/shared-types').SendMessagePayload = {
            event: 'message.send',
            data: {
              inbox_id: Number(msg.inbox_id),
              internal_message_id: Number(insertedMessage.id),
              target_id: msg.phone_number.includes('@') ? msg.phone_number : `${msg.phone_number}@s.whatsapp.net`,
              content: msg.content,
              message_type: 'text'
            }
          };

          // Push to redis queue
          const targetQueue = `queue:outgoing_messages:inbox_${msg.inbox_id}`;
          await redis.rpush(targetQueue, JSON.stringify(payload));

          // Broadcast WS message.new to UI
          const wsPayload = {
            id: insertedMessage.id,
            conversation_id: msg.conversation_id,
            sender_type: 'Agent',
            sender_id: msg.created_by,
            content: msg.content,
            status: 'pending',
            created_at: insertedMessage.created_at
          };

          await redis.publish('chat:events', JSON.stringify({
            event: 'message.new',
            data: wsPayload
          }));

          // Broadcast schedule fulfilled
          await redis.publish('chat:events', JSON.stringify({
            event: 'message.schedule_sent',
            data: {
              id: msg.id,
              conversation_id: msg.conversation_id,
              message_id: insertedMessage.id
            }
          }));

        } catch (err: any) {
          console.error(`[ScheduledWorker] Error processing message ${msg.id}:`, err);
          await tx`
            UPDATE scheduled_messages 
            SET status = 'failed', error_message = ${err.message}, updated_at = NOW()
            WHERE id = ${msg.id}
          `;
        }
      }
    });
  } catch (err) {
    console.error('[ScheduledWorker] Top level error:', err);
  }
}

let isRunning = false;

export function startScheduledMessagesWorker() {
  console.log('[Worker] Scheduled Messages checker started (60s interval)');
  setInterval(async () => {
    if ((globalThis as any).isShuttingDown) return;
    if (isRunning) return;
    isRunning = true;
    try {
      await processScheduledMessages();
    } finally {
      isRunning = false;
    }
  }, 60000);
}
