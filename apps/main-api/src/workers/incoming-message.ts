import { redis, redisWorker, PUB_SUB_CH, QUEUE_INCOMING } from '../config/redis';
import { sql } from '../config/database';
import path from 'path';
import type { IncomingMessagePayload, SendMessagePayload } from '@omnichannel/shared-types';
import { RedisQueuePayloadSchema, IncomingMessagePayloadSchema, MessageStatusUpdatePayloadSchema } from '@omnichannel/shared-types';
import { getActiveChatbotRules, evaluateChatbot } from '../chatbot/engine';
import { isWithinBusinessHours } from '../config/business-hours';
import { dispatchWebhook } from '../utils/webhooks';
import { evaluateAutomationRules } from '../utils/automation';
import { logger } from '../utils/monitoring';

export async function startWorker() {
  logger.info('Worker API: Berjalan (Siap menerima pesan dari Valkey)');
  
  while (!(globalThis as any).isShuttingDown) {
    try {
      const result = await redisWorker.brpop(QUEUE_INCOMING, 0);
        if (result) {
          const [_, messageStr] = result;
          logger.debug({ rawPayload: messageStr }, 'Menerima Payload dari Redis');

          let parsedObj: any;
          try {
            parsedObj = JSON.parse(messageStr);
          } catch (e) {
            logger.error({ err: e, rawPayload: messageStr }, 'Payload dari Redis bukan JSON valid, diabaikan.');
            continue;
          }

          const validationResult = RedisQueuePayloadSchema.safeParse(parsedObj);
          
          if (!validationResult.success) {
            logger.error({ err: validationResult.error.format() }, 'Validasi payload Redis gagal. Schema mismatch');
            continue;
          }

          const payload = validationResult.data as any; // Tipe sudah divalidasi
          
          if (payload.event === 'message.incoming') {
            const savedMessage = await processIncomingMessageToDB(payload.data);
            if (savedMessage) {
              await redis.publish(PUB_SUB_CH, JSON.stringify({
                event: 'message.new',
                data: savedMessage
              }));
              // Trigger automation rules for incoming message
              evaluateAutomationRules(savedMessage.account_id, 'message.incoming', savedMessage)
                .catch(err => logger.error({ err }, '[Automation Worker] Error executing rules'));
            }
          } else if (payload.event === 'message.status_update') {
            const { wa_message_id, status, internal_message_id } = payload.data as any;
            
            // Prioritas 1: Jika ada internal_message_id (dari wa-adapter saat baru dikirim)
            if (internal_message_id) {
              const [updated] = await sql`
                UPDATE messages 
                SET wa_message_id = ${wa_message_id}, status = ${status} 
                WHERE id = ${internal_message_id}
                RETURNING *
              `;
              if (updated) {
                await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.status_changed', data: updated }));
              }
            } else {
              // Prioritas 2: Update berdasarkan wa_message_id
              const validTransitions: Record<string, string[]> = {
                'sent': ['delivered', 'read', 'failed'],
                'delivered': ['read'],
                'read': [],
                'failed': []
              };

              const [currentMsg] = await sql`SELECT id, status FROM messages WHERE wa_message_id = ${wa_message_id} LIMIT 1`;
              
              if (currentMsg) {
                // Pastikan status tidak downgrade (misal read ke delivered)
                const allowedNext = validTransitions[currentMsg.status] || [];
                if (allowedNext.includes(status) || currentMsg.status === status) {
                  const [updated] = await sql`
                    UPDATE messages SET status = ${status} WHERE id = ${currentMsg.id} RETURNING *
                  `;
                  await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.status_changed', data: updated }));
                }
              }
            }
          }
      }
    } catch (err) {
      if ((globalThis as any).isShuttingDown) {
        break;
      }
      logger.error({ err }, 'Worker processing error');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

async function processIncomingMessageToDB(data: IncomingMessagePayload['data']) {
  try {
    let isNewContact = false;
    let contactData: any = null;
    let isNewConversation = false;
    let oooMsgData: any = null;

    const result = await sql.begin(async (tx: any) => {
      logger.debug({ wa_message_id: data.wa_message_id, is_host_echo: data.is_host_echo }, 'Memproses pesan masuk');

      const INBOX_ID = data.inbox_id;
      if (!INBOX_ID) {
        logger.error('Payload incoming message tidak menyertakan inbox_id.');
        return null;
      }

      const [inbox] = await tx`SELECT account_id FROM inboxes WHERE id = ${INBOX_ID} LIMIT 1`;
      if (!inbox) {
        logger.error({ inboxId: INBOX_ID }, 'Inbox tidak ditemukan di database.');
        return null;
      }
      const ACCOUNT_ID = inbox.account_id;

    const sourceJid = data.source_jid || 'unknown';
    const displayName = data.push_name || 'Unknown User';
    const timestamp = data.timestamp || Math.floor(Date.now() / 1000);
    const content = data.content || '';

    let [contact] = await tx`
      SELECT id, deleted_at, merged_into_id FROM contacts 
      WHERE phone_number = ${sourceJid} AND account_id = ${ACCOUNT_ID} 
      LIMIT 1
    `;
    
    if (contact) {
      if (contact.deleted_at) {
        if (contact.merged_into_id) {
          const [primaryContact] = await tx`
            SELECT id FROM contacts WHERE id = ${contact.merged_into_id} AND deleted_at IS NULL LIMIT 1
          `;
          contact = primaryContact || null;
        } else {
          contact = null;
        }
      }
    }

    if (!contact) {
      isNewContact = true;
      const cleanPhone = (data.source_jid || '').split('@')[0] || '';
      [contact] = await tx`
        INSERT INTO contacts (account_id, name, phone_number)
        VALUES (${ACCOUNT_ID}, ${displayName || cleanPhone}, ${cleanPhone})
        RETURNING id, name, phone_number, email;
      `;
      contactData = contact;
    } else {
      await tx`
        UPDATE contacts SET name = ${displayName}, updated_at = NOW() 
        WHERE id = ${contact.id} AND name != ${displayName}
      `;
    }

    let conversation = null;
    let threadedTicketId = null;

    if (data.email_metadata && data.email_metadata.in_reply_to) {
      const [existingThread] = await tx`
        SELECT m.conversation_id, m.ticket_id
        FROM email_message_metadata em
        JOIN messages m ON em.message_id = m.id
        WHERE em.email_message_id = ${data.email_metadata.in_reply_to}
        LIMIT 1
      `;
      if (existingThread) {
        conversation = { id: existingThread.conversation_id };
        threadedTicketId = existingThread.ticket_id;
      }
    }

    if (!conversation) {
      const [conv] = await tx`
        SELECT id FROM conversations
        WHERE account_id = ${ACCOUNT_ID} 
          AND inbox_id = ${INBOX_ID} 
          AND contact_id = ${contact.id}
        LIMIT 1
      `;
      conversation = conv;
    }

    if (!conversation) {
      isNewConversation = true;
      const [newConv] = await tx`
        INSERT INTO conversations (account_id, inbox_id, contact_id)
        VALUES (${ACCOUNT_ID}, ${INBOX_ID}, ${contact.id})
        RETURNING id;
      `;
      conversation = newConv;
    }

    let isOffHours = false;
    let oooMessage = '';
    if (!data.is_host_echo) {
      const bhStatus = await isWithinBusinessHours(INBOX_ID, tx);
      isOffHours = !bhStatus.isOpen;
      oooMessage = bhStatus.oooMessage;
    }

    let [ticket] = await tx`
      SELECT id, status, is_bot_active, bot_state, csat_survey_sent, assignee_id FROM tickets
      WHERE account_id = ${ACCOUNT_ID} AND conversation_id = ${conversation.id}
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    let isCSATReply = false;
    if (!data.is_host_echo && ticket && ticket.status === 'resolved' && ticket.csat_survey_sent) {
      const [existingRating] = await tx`
        SELECT id FROM csat_ratings WHERE ticket_id = ${ticket.id} LIMIT 1
      `;
      if (!existingRating && /^[1-5]$/.test(content.trim())) {
        const ratingVal = parseInt(content.trim(), 10);
        await tx`
          INSERT INTO csat_ratings (account_id, ticket_id, conversation_id, contact_id, assigned_agent_id, rating)
          VALUES (${ACCOUNT_ID}, ${ticket.id}, ${conversation.id}, ${contact.id}, ${ticket.assignee_id}, ${ratingVal})
          ON CONFLICT (ticket_id) DO NOTHING
        `;
        const systemText = `Pelanggan memberikan rating kepuasan: ${ratingVal}/5`;
        const [sysMsg] = await tx`
          INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, sender_id, content, message_type, status)
          VALUES (${ACCOUNT_ID}, ${conversation.id}, ${ticket.id}, 'System', NULL, ${systemText}, 'template', 'sent')
          RETURNING *;
        `;
        await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: sysMsg }));
        isCSATReply = true;
      }
    }

    const rules = await getActiveChatbotRules(INBOX_ID);
    let triggeredGlobalCommand = false;
    if (rules && rules.global_commands) {
      const commandKey = content.trim().toLowerCase();
      if (rules.global_commands[commandKey]) {
        triggeredGlobalCommand = true;
        const targetState = rules.global_commands[commandKey];
        
        if (ticket && ticket.status !== 'resolved') {
          [ticket] = await tx`
            UPDATE tickets 
            SET is_bot_active = true, bot_state = ${targetState}, updated_at = NOW() 
            WHERE id = ${ticket.id}
            RETURNING id, status, is_bot_active, bot_state;
          `;
        }
      }
    }

    let isNewTicket = false;
    if (!data.is_host_echo && !isCSATReply && (!ticket || ticket.status === 'resolved')) {
      isNewTicket = true;
      const initialStatus = isOffHours ? 'pending' : 'open';
      const initialBotActive = isOffHours ? false : true;

      [ticket] = await tx`
        INSERT INTO tickets (account_id, conversation_id, status, is_bot_active, bot_state)
        VALUES (${ACCOUNT_ID}, ${conversation.id}, ${initialStatus}, ${initialBotActive}, ${triggeredGlobalCommand ? rules.global_commands[content.trim().toLowerCase()] : 'start'})
        RETURNING id, status, is_bot_active, bot_state;
      `;

      // Auto-Assignment Logic (bypassed if off-hours)
      if (!isOffHours) {
        try {
          const [settings] = await tx`
            SELECT auto_assignment_enabled, auto_assignment_algorithm, auto_assignment_max_tickets, last_assigned_user_id
            FROM inbox_settings
            WHERE inbox_id = ${INBOX_ID} AND account_id = ${ACCOUNT_ID}
            LIMIT 1
          `;

          if (settings && settings.auto_assignment_enabled) {
            const eligibleAgents = await tx`
              SELECT au.user_id, u.name, COALESCE(t_count.active_count, 0) AS active_count
              FROM account_users au
              JOIN users u ON au.user_id = u.id
              LEFT JOIN (
                SELECT assignee_id, COUNT(*) AS active_count
                FROM tickets
                WHERE account_id = ${ACCOUNT_ID} AND status IN ('open', 'pending')
                GROUP BY assignee_id
              ) t_count ON au.user_id = t_count.assignee_id
              WHERE au.account_id = ${ACCOUNT_ID}
                AND au.availability_status = 'online'
                AND COALESCE(t_count.active_count, 0) < ${settings.auto_assignment_max_tickets}
              ORDER BY au.user_id ASC
            `;

            if (eligibleAgents.length > 0) {
              let selectedAgent = null;
              if (settings.auto_assignment_algorithm === 'least_busy') {
                eligibleAgents.sort((a: any, b: any) => {
                  const countA = Number(a.active_count);
                  const countB = Number(b.active_count);
                  if (countA !== countB) {
                    return countA - countB;
                  }
                  return Number(a.user_id) - Number(b.user_id);
                });
                selectedAgent = eligibleAgents[0];
              } else { // round_robin
                eligibleAgents.sort((a: any, b: any) => Number(a.user_id) - Number(b.user_id));
                const lastId = settings.last_assigned_user_id ? Number(settings.last_assigned_user_id) : null;
                let nextAgent = null;
                if (lastId !== null) {
                  nextAgent = eligibleAgents.find((agent: any) => Number(agent.user_id) > lastId);
                }
                selectedAgent = nextAgent || eligibleAgents[0];
              }

              if (selectedAgent) {
                const agentId = Number(selectedAgent.user_id);
                const [updatedTicket] = await tx`
                  UPDATE tickets
                  SET assignee_id = ${agentId}, updated_at = NOW()
                  WHERE id = ${ticket.id}
                  RETURNING id, status, is_bot_active, bot_state;
                `;
                if (updatedTicket) {
                  ticket = updatedTicket;
                }

                await tx`
                  UPDATE inbox_settings
                  SET last_assigned_user_id = ${agentId}, updated_at = NOW()
                  WHERE inbox_id = ${INBOX_ID}
                `;

                await tx`
                  INSERT INTO conversation_events (account_id, conversation_id, ticket_id, actor_type, actor_id, event_type, event_data)
                  VALUES (${ACCOUNT_ID}, ${conversation.id}, ${ticket.id}, 'System', NULL, 'assigned', ${tx.json({ new_assignee_id: agentId, method: 'auto_assignment' })})
                `;

                const systemText = `Tiket #TKT-${String(ticket.id).padStart(4, '0')} di-assign otomatis ke ${selectedAgent.name}`;
                const [sysMsg] = await tx`
                  INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, sender_id, content, message_type, status)
                  VALUES (${ACCOUNT_ID}, ${conversation.id}, ${ticket.id}, 'System', NULL, ${systemText}, 'template', 'sent')
                  RETURNING *;
                `;

                await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: sysMsg }));
              }
            }
          }
        } catch (assignError) {
          logger.error({ err: assignError }, 'Gagal menjalankan auto-assignment');
        }
      }
    } else if (ticket && ticket.status !== 'resolved') {
      if (!triggeredGlobalCommand) {
        if (ticket.status === 'snoozed') {
           await tx`UPDATE tickets SET status = 'open', updated_at = NOW() WHERE id = ${ticket.id}`;
           ticket.status = 'open';
        } else {
           await tx`UPDATE tickets SET updated_at = NOW() WHERE id = ${ticket.id}`;
        }
      }
    }

    const finalContent = data.participant_id 
      ? `[${data.participant_name || 'Member'}]: ${content}` 
      : content;

    const [msg] = await tx`
      INSERT INTO messages (
        account_id, conversation_id, ticket_id, sender_type, sender_id, 
        content, message_type, status, created_at, wa_message_id
      ) VALUES (
        ${ACCOUNT_ID}, ${conversation.id}, ${ticket && (ticket.status !== 'resolved' || isCSATReply) ? ticket.id : null}, 
        ${data.is_host_echo ? 'User' : 'Contact'}, 
        ${data.is_host_echo ? null : contact.id}, 
        ${finalContent}, 
        ${data.is_host_echo ? 'outgoing' : 'incoming'}, 
        'delivered', 
        to_timestamp(${timestamp}),
        ${data.wa_message_id}
      )
      RETURNING *;
    `;

    if (data.email_metadata) {
      await tx`
        INSERT INTO email_message_metadata (
          message_id, email_message_id, in_reply_to, email_references,
          from_address, to_addresses, cc_addresses, bcc_addresses,
          subject, html_content, has_attachments, email_date
        ) VALUES (
          ${msg.id}, 
          ${data.email_metadata.message_id || null}, 
          ${data.email_metadata.in_reply_to || null}, 
          ${data.email_metadata.references || null},
          ${data.email_metadata.from_address}, 
          ${data.email_metadata.to_addresses || []}, 
          ${data.email_metadata.cc_addresses || []}, 
          ${data.email_metadata.bcc_addresses || []},
          ${data.email_metadata.subject || null}, 
          ${data.email_metadata.html_content || null}, 
          ${data.email_metadata.has_attachments || false},
          ${data.email_metadata.email_date ? new Date(data.email_metadata.email_date) : null}
        )
      `;
    }

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
        
        const [attachment] = await tx`
          INSERT INTO attachments (message_id, file_type, file_url, original_filename)
          VALUES (${msg.id}, ${mimetype}, ${fileUrl}, ${originalName})
          RETURNING *;
        `;
        attachmentData = attachment;
      } catch (mediaErr) {
        logger.error({ err: mediaErr }, 'Gagal memproses media lampiran');
      }
    }

    if (isNewTicket && isOffHours) {
      try {
        const [oooMsg] = await tx`
          INSERT INTO messages (
            account_id, conversation_id, ticket_id, sender_type, sender_id, 
            content, message_type, status
          ) VALUES (
            ${ACCOUNT_ID}, ${conversation.id}, ${ticket.id}, 
            'System', NULL, 
            ${oooMessage}, 
            'outgoing', 
            'sent'
          )
          RETURNING *;
        `;
        oooMsgData = oooMsg;

        const oooPayload: SendMessagePayload = {
          event: 'message.send',
          data: {
            inbox_id: Number(INBOX_ID),
            internal_message_id: Number(oooMsg.id),
            target_id: sourceJid,
            content: oooMessage,
            message_type: 'text'
          }
        };
        const oooPayloadStr = JSON.stringify({ ...oooPayload, _queued_at: Date.now() });
        const targetQueue = `queue:outgoing_messages:inbox_${INBOX_ID}`;
        await redis.rpush(targetQueue, oooPayloadStr);

        await redis.publish(PUB_SUB_CH, JSON.stringify({
          event: 'message.new',
          data: {
            ...oooMsg,
            contact_name: displayName,
            attachments: []
          }
        }));
      } catch (oooErr) {
        logger.error({ err: oooErr }, 'Gagal mengirim/menyimpan pesan OOO');
      }
    }

    if (!data.is_host_echo && !isCSATReply && ticket && ticket.is_bot_active && !isOffHours) {
      await evaluateChatbot(tx, ticket, content, sourceJid, displayName, triggeredGlobalCommand, ACCOUNT_ID, conversation.id, INBOX_ID);
    }

    return { 
      msg: {
        ...msg, 
        contact_name: displayName,
        attachments: attachmentData ? [attachmentData] : [] 
      },
      isNewContact,
      contactData,
      isNewConversation,
      conversationId: Number(conversation.id),
      contactId: Number(contact.id),
      accountId: Number(ACCOUNT_ID),
      inboxId: Number(INBOX_ID),
      oooMsgData
    };
    });

    if (result) {
      if (result.isNewContact && result.contactData) {
        dispatchWebhook(result.accountId, 'contact.created', result.contactData).catch(e => logger.error({ err: e }, 'Webhook dispatch failed'));
        // Trigger automation rules for contact created
        evaluateAutomationRules(result.accountId, 'contact.created', result.contactData)
          .catch(err => logger.error({ err }, '[Automation Worker] Error executing rules'));
      }
      if (result.isNewConversation) {
        dispatchWebhook(result.accountId, 'conversation.created', {
          id: result.conversationId,
          account_id: result.accountId,
          inbox_id: result.inboxId,
          contact_id: result.contactId
        }).catch(e => logger.error({ err: e }, 'Webhook dispatch failed'));

        try {
          const { createNotificationsBatch } = await import('../utils/notifications');
          const eligibleUsers = await sql`SELECT user_id FROM account_users WHERE account_id = ${result.accountId}`;
          const userIds = eligibleUsers.map((row: { user_id: string | number }) => Number(row.user_id));
          await createNotificationsBatch({
            userIds,
            accountId: result.accountId,
            type: 'new_conversation',
            title: 'Percakapan Baru',
            body: `Percakapan baru dimulai oleh ${result.msg.contact_name || 'Pelanggan'}`,
            data: { conversation_id: result.conversationId }
          });
        } catch (err) {
          logger.error({ err }, 'Failed to create new conversation notification');
        }
      }
      if (!data.is_host_echo) {
        dispatchWebhook(result.accountId, 'message.incoming', result.msg).catch(e => logger.error({ err: e }, 'Webhook dispatch failed'));
      } else {
        dispatchWebhook(result.accountId, 'message.outgoing', result.msg).catch(e => logger.error({ err: e }, 'Webhook dispatch failed'));
      }
      if (result.oooMsgData) {
        dispatchWebhook(result.accountId, 'message.outgoing', result.oooMsgData).catch(e => logger.error({ err: e }, 'Webhook dispatch failed'));
      }

      return result.msg;
    }
    return null;
  } catch (error) {
    logger.error({ err: error }, 'Gagal menyimpan ke database');
    return null;
  }
}
