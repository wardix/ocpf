import { redis, redisWorker, sql, PUB_SUB_CH, QUEUE_INCOMING } from '../config/redis';
import { sql as db } from '../config/database';
import path from 'path';
import type { IncomingMessagePayload, SendMessagePayload } from '@omnichannel/shared-types';
import { chatbotRules, evaluateChatbot } from '../chatbot/engine';

export async function startWorker() {
  console.log('Worker API: Berjalan (Siap menerima pesan dari Valkey)');
  
  while (true) {
    try {
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
    console.log(`\\n[DEBUG-ECHO] Memproses pesan masuk: ${data.wa_message_id}`);
    console.log(`[DEBUG-ECHO] is_host_echo bernilai:`, data.is_host_echo);

    const INBOX_ID = data.inbox_id || 1; 
    
    const [inbox] = await db`SELECT account_id FROM inboxes WHERE id = ${INBOX_ID} LIMIT 1`;
    if (!inbox) {
      console.error(`Inbox ID ${INBOX_ID} tidak ditemukan di database.`);
      return null;
    }
    const ACCOUNT_ID = inbox.account_id;

    const sourceJid = data.source_jid || 'unknown';
    const displayName = data.push_name || 'Unknown User';
    const timestamp = data.timestamp || Math.floor(Date.now() / 1000);
    const content = data.content || '';

    let [contact] = await db`
      SELECT id FROM contacts WHERE phone_number = ${sourceJid} AND account_id = ${ACCOUNT_ID} LIMIT 1
    `;
    
    if (!contact) {
      [contact] = await db`
        INSERT INTO contacts (account_id, name, phone_number)
        VALUES (${ACCOUNT_ID}, ${displayName}, ${sourceJid})
        RETURNING id;
      `;
    } else {
      await db`
        UPDATE contacts SET name = ${displayName}, updated_at = NOW() 
        WHERE id = ${contact.id} AND name != ${displayName}
      `;
    }

    let [conversation] = await db`
      SELECT id FROM conversations
      WHERE account_id = ${ACCOUNT_ID} 
        AND inbox_id = ${INBOX_ID} 
        AND contact_id = ${contact.id}
      LIMIT 1
    `;

    if (!conversation) {
      [conversation] = await db`
        INSERT INTO conversations (account_id, inbox_id, contact_id)
        VALUES (${ACCOUNT_ID}, ${INBOX_ID}, ${contact.id})
        RETURNING id;
      `;
    }

    let [ticket] = await db`
      SELECT id, status, is_bot_active, bot_state FROM tickets
      WHERE account_id = ${ACCOUNT_ID} AND conversation_id = ${conversation.id}
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    let triggeredGlobalCommand = false;
    if (chatbotRules && chatbotRules.global_commands) {
      const commandKey = content.trim().toLowerCase();
      if (chatbotRules.global_commands[commandKey]) {
        triggeredGlobalCommand = true;
        const targetState = chatbotRules.global_commands[commandKey];
        
        if (ticket && ticket.status !== 'resolved') {
          [ticket] = await db`
            UPDATE tickets 
            SET is_bot_active = true, bot_state = ${targetState}, updated_at = NOW() 
            WHERE id = ${ticket.id}
            RETURNING id, status, is_bot_active, bot_state;
          `;
        }
      }
    }

    if (!data.is_host_echo && (!ticket || ticket.status === 'resolved')) {
      [ticket] = await db`
        INSERT INTO tickets (account_id, conversation_id, status, is_bot_active, bot_state)
        VALUES (${ACCOUNT_ID}, ${conversation.id}, 'open', true, ${triggeredGlobalCommand ? chatbotRules.global_commands[content.trim().toLowerCase()] : 'start'})
        RETURNING id, status, is_bot_active, bot_state;
      `;
    } else if (ticket && ticket.status !== 'resolved') {
      if (!triggeredGlobalCommand) {
        if (ticket.status === 'snoozed') {
           await db`UPDATE tickets SET status = 'open', updated_at = NOW() WHERE id = ${ticket.id}`;
           ticket.status = 'open';
        } else {
           await db`UPDATE tickets SET updated_at = NOW() WHERE id = ${ticket.id}`;
        }
      }
    }

    const finalContent = data.participant_id 
      ? `[${data.participant_name || 'Member'}]: ${content}` 
      : content;

    const [msg] = await db`
      INSERT INTO messages (
        account_id, conversation_id, ticket_id, sender_type, sender_id, 
        content, message_type, status, created_at
      ) VALUES (
        ${ACCOUNT_ID}, ${conversation.id}, ${ticket && ticket.status !== 'resolved' ? ticket.id : null}, 
        ${data.is_host_echo ? 'User' : 'Contact'}, 
        ${data.is_host_echo ? null : contact.id}, 
        ${finalContent}, 
        ${data.is_host_echo ? 'outgoing' : 'incoming'}, 
        'delivered', 
        to_timestamp(${timestamp})
      )
      RETURNING *;
    `;

    let attachmentData = null;
    if (data.media) {
      try {
        const { mimetype, data_base64, filename } = data.media;
        
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'audio/ogg', 'audio/mpeg', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        if (!allowedMimeTypes.includes(mimetype) && !mimetype.startsWith('audio/')) {
          throw new Error(`MIME type tidak diizinkan: ${mimetype}`);
        }

        const buffer = Buffer.from(data_base64, 'base64');
        
        const MAX_SIZE = 25 * 1024 * 1024;
        if (buffer.length > MAX_SIZE) {
          throw new Error('Ukuran file melebihi batas 25MB');
        }

        const originalName = filename ? filename.replace(/^.*[\\\\\\/]/, '').replace(/[^a-zA-Z0-9.\\-_]/g, '_') : 'unnamed_file';
        
        const ext = mimetype.split('/')[1]?.split(';')[0] || 'bin';
        const safeFilename = `${crypto.randomUUID()}.${ext}`;
        
        const uploadPath = path.join(process.cwd(), 'public', 'uploads', safeFilename);
        await Bun.write(uploadPath, buffer);
        
        const fileUrl = `/uploads/${safeFilename}`;
        
        const [attachment] = await db`
          INSERT INTO attachments (message_id, file_type, file_url, original_filename)
          VALUES (${msg.id}, ${mimetype}, ${fileUrl}, ${originalName})
          RETURNING *;
        `;
        attachmentData = attachment;
      } catch (mediaErr) {
        console.error('Gagal memproses media lampiran:', mediaErr);
      }
    }

    if (!data.is_host_echo && ticket.is_bot_active) {
      await evaluateChatbot(ticket, content, sourceJid, displayName, triggeredGlobalCommand, ACCOUNT_ID, conversation.id, INBOX_ID);
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
