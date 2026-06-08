import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import Redis from 'ioredis';
import pino from 'pino';
import { 
  IncomingMessagePayload, 
  IncomingMessagePayloadSchema, 
  SendMessagePayload, 
  SendMessagePayloadSchema 
} from '@omnichannel/shared-types';

const redis = new Redis({ host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT) || 6379 });
const redisSub = new Redis({ host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT) || 6379 });

const logger = pino();

const QUEUE_INCOMING = 'queue:incoming_messages';

const EMAIL_INBOXES = process.env.EMAIL_INBOXES ? JSON.parse(process.env.EMAIL_INBOXES) : [];

let isShuttingDown = false;
const clients = new Map<number, ImapFlow>();
const transporters = new Map<number, nodemailer.Transporter>();

async function startImapForInbox(inbox: any) {
  const client = new ImapFlow({
    host: inbox.imap_host,
    port: inbox.imap_port,
    secure: inbox.imap_secure ?? true,
    auth: {
      user: inbox.user,
      pass: inbox.pass
    },
    logger: false // Disable verbose imapflow logs
  });

  clients.set(inbox.id, client);

  try {
    await client.connect();
    logger.info(`[Email Inbox ${inbox.id}] Connected to IMAP server`);

    let lock = await client.getMailboxLock('INBOX');
    try {
      client.on('exists', async (data) => {
        logger.info(`[Email Inbox ${inbox.id}] New message exists: ${data.count}`);
        // Fetch the newest message. In a real app, track UIDNEXT.
        const message = await client.fetchOne(client.mailbox.exists, { source: true, uid: true });
        if (message) {
          await processIncomingEmail(inbox.id, message.source.toString(), message.uid.toString());
        }
      });
      logger.info(`[Email Inbox ${inbox.id}] Listening for new emails (IDLE)`);
      // Start IDLE
      for await (const msg of client.fetch('1:*', { source: true, uid: true })) {
         // Just a placeholder to ensure mailbox is selected. We don't want to process all past emails on every start without a watermark.
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    logger.error(`[Email Inbox ${inbox.id}] IMAP Connection error:`, err);
  }
}

async function processIncomingEmail(inboxId: number, rawSource: string, uid: string) {
  try {
    const parsed = await simpleParser(rawSource);
    
    const messageId = parsed.messageId || `email-${uid}-${Date.now()}`;
    const fromAddress = parsed.from?.value[0]?.address || 'unknown@example.com';
    const fromName = parsed.from?.value[0]?.name || fromAddress;
    const toAddresses = parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap(t => t.value.map(v => v.address || '')) : [];
    const ccAddresses = parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]).flatMap(t => t.value.map(v => v.address || '')) : [];
    const subject = parsed.subject || '';
    const textContent = parsed.text || '';
    const htmlContent = parsed.html || '';

    const payload: IncomingMessagePayload = {
      event: 'message.incoming',
      data: {
        inbox_id: inboxId,
        source_id: fromAddress,
        source_jid: fromAddress,
        push_name: fromName,
        content: textContent,
        message_type: 'text',
        wa_message_id: messageId,
        timestamp: parsed.date ? parsed.date.getTime() : Date.now(),
        email_metadata: {
          message_id: messageId,
          in_reply_to: parsed.inReplyTo,
          references: parsed.references ? (Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references) : undefined,
          from_address: fromAddress,
          to_addresses: toAddresses,
          cc_addresses: ccAddresses,
          subject: subject,
          html_content: htmlContent,
          has_attachments: parsed.attachments.length > 0,
          email_date: parsed.date ? parsed.date.toISOString() : new Date().toISOString()
        }
      }
    };

    const validatedPayload = IncomingMessagePayloadSchema.parse(payload);
    await redis.rpush(QUEUE_INCOMING, JSON.stringify(validatedPayload));
    logger.info(`[Email Inbox ${inboxId}] Pushed incoming email to queue from ${fromAddress}`);
  } catch (error) {
    logger.error(`[Email Inbox ${inboxId}] Error processing email:`, error);
  }
}

async function listenForOutgoingEmails() {
  const queues = EMAIL_INBOXES.map((i: any) => `queue:outgoing_messages:inbox_${i.id}`);
  if (queues.length === 0) {
    logger.info('No email inboxes configured for outgoing queue.');
    return;
  }
  logger.info(`Listening for outgoing emails on: ${queues.join(', ')}`);

  while (!isShuttingDown) {
    try {
      const result = await redisSub.brpop(...queues, 5);
      if (result) {
        const [queueName, messageDataString] = result;
        const targetInboxId = parseInt(queueName.split('_').pop() || '0');
        
        const parsed = JSON.parse(messageDataString);
        if (parsed.event === 'message.send') {
          const payload = parsed as SendMessagePayload;
          const inbox = EMAIL_INBOXES.find((i: any) => i.id === targetInboxId);
          if (!inbox) continue;

          let transporter = transporters.get(targetInboxId);
          if (!transporter) {
            transporter = nodemailer.createTransport({
              host: inbox.smtp_host,
              port: inbox.smtp_port,
              secure: inbox.smtp_secure ?? true,
              auth: {
                user: inbox.user,
                pass: inbox.pass
              }
            });
            transporters.set(targetInboxId, transporter);
          }

          const { target_id, content, email_metadata } = payload.data;
          
          const mailOptions: nodemailer.SendMailOptions = {
            from: inbox.user,
            to: target_id,
            subject: email_metadata?.subject || 'Re: Message',
            text: content || '',
            html: email_metadata?.html_content,
            cc: email_metadata?.cc_addresses,
            bcc: email_metadata?.bcc_addresses,
            inReplyTo: email_metadata?.in_reply_to,
            references: email_metadata?.references,
          };

          const info = await transporter.sendMail(mailOptions);
          logger.info(`[Email Inbox ${targetInboxId}] Sent email to ${target_id}. MessageId: ${info.messageId}`);

          // Status update
          const bindingPayload = {
            event: 'message.status_update' as const,
            data: {
              inbox_id: targetInboxId,
              wa_message_id: info.messageId,
              internal_message_id: payload.data.internal_message_id,
              source_id: target_id,
              status: 'sent' as const,
              timestamp: Math.floor(Date.now() / 1000)
            }
          };
          await redis.rpush(QUEUE_INCOMING, JSON.stringify(bindingPayload));
        }
      }
    } catch (err) {
      logger.error('Error sending email:', err);
    }
  }
}

if (EMAIL_INBOXES.length > 0) {
  for (const inbox of EMAIL_INBOXES) {
    startImapForInbox(inbox);
  }
  listenForOutgoingEmails();
} else {
  logger.info('No EMAIL_INBOXES defined. Email adapter is idle.');
}
