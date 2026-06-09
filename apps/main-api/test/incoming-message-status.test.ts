import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { redisWorker, QUEUE_INCOMING } from '../src/config/redis';
import { startWorker } from '../src/workers/incoming-message';
import { EventEmitter } from 'events';
import crypto from 'crypto';

describe('Incoming Message Worker - Status Updates', () => {
  let tenantId: number;
  let userId: number;
  let channelId: number;
  let inboxId: number;
  let contactId: number;
  let convId: number;

  const queueEmitter = new EventEmitter();
  const payloadQueue: any[] = [];
  const originalBrpop = redisWorker.brpop;

  beforeAll(async () => {
    // 1. Reset sequences
    await sql`SELECT setval('accounts_id_seq', COALESCE((SELECT MAX(id) FROM accounts), 1), true)`;
    await sql`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), true)`;
    await sql`SELECT setval('channels_id_seq', COALESCE((SELECT MAX(id) FROM channels), 1), true)`;
    await sql`SELECT setval('inboxes_id_seq', COALESCE((SELECT MAX(id) FROM inboxes), 1), true)`;
    await sql`SELECT setval('contacts_id_seq', COALESCE((SELECT MAX(id) FROM contacts), 1), true)`;
    await sql`SELECT setval('conversations_id_seq', COALESCE((SELECT MAX(id) FROM conversations), 1), true)`;
    await sql`SELECT setval('messages_id_seq', COALESCE((SELECT MAX(id) FROM messages), 1), true)`;

    // 2. Setup database test structure
    const [acc] = await sql`INSERT INTO accounts (name) VALUES ('Status Test Account') RETURNING id`;
    tenantId = Number(acc.id);

    const email = `status_user_${crypto.randomBytes(4).toString('hex')}@test.local`;
    const [user] = await sql`INSERT INTO users (name, email, password_hash) VALUES ('Status Agent', ${email}, 'hash') RETURNING id`;
    userId = Number(user.id);

    const [channel] = await sql`INSERT INTO channels (account_id, name, provider_type, provider_config) VALUES (${tenantId}, 'WA Status', 'whatsapp', '{}') RETURNING id`;
    channelId = Number(channel.id);

    const [inbox] = await sql`INSERT INTO inboxes (account_id, channel_id, name) VALUES (${tenantId}, ${channelId}, 'WA Inbox') RETURNING id`;
    inboxId = Number(inbox.id);

    const [contact] = await sql`INSERT INTO contacts (account_id, name, phone_number) VALUES (${tenantId}, 'Contact Status', '628999999123') RETURNING id`;
    contactId = Number(contact.id);

    const [conv] = await sql`INSERT INTO conversations (account_id, inbox_id, contact_id) VALUES (${tenantId}, ${inboxId}, ${contactId}) RETURNING id`;
    convId = Number(conv.id);

    // 3. Mock redisWorker.brpop to fetch from our local queue
    redisWorker.brpop = async (queue: string, timeout: number): Promise<any> => {
      if (payloadQueue.length > 0) {
        const nextPayload = payloadQueue.shift();
        return [queue, JSON.stringify(nextPayload)];
      }
      return new Promise<any>((resolve) => {
        queueEmitter.once('push', () => {
          const nextPayload = payloadQueue.shift();
          resolve(nextPayload ? [queue, JSON.stringify(nextPayload)] : null);
        });
      });
    };

    // 4. Start the worker in the background
    startWorker().catch(err => console.error('Worker error in test:', err));
  });

  afterAll(async () => {
    // Unblock the worker loop and restore
    queueEmitter.emit('push');
    redisWorker.brpop = originalBrpop;

    // Clean up DB
    if (tenantId) {
      await sql`DELETE FROM messages WHERE account_id = ${tenantId}`;
      await sql`DELETE FROM conversations WHERE account_id = ${tenantId}`;
      await sql`DELETE FROM contacts WHERE account_id = ${tenantId}`;
      await sql`DELETE FROM inboxes WHERE account_id = ${tenantId}`;
      await sql`DELETE FROM channels WHERE account_id = ${tenantId}`;
      if (userId) {
        await sql`DELETE FROM users WHERE id = ${userId}`;
      }
      await sql`DELETE FROM accounts WHERE id = ${tenantId}`;
    }
  });

  it('should update message status to read using wa_message_id (Priority 2)', async () => {
    // 1. Create a test outgoing message with 'sent' status
    const waMsgId = 'wa_msg_test_status_123';
    const [msg] = await sql`
      INSERT INTO messages (account_id, conversation_id, sender_type, content, message_type, wa_message_id, status)
      VALUES (${tenantId}, ${convId}, 'User', 'Hello Status 1', 'outgoing', ${waMsgId}, 'sent')
      RETURNING id
    `;
    const messageId = Number(msg.id);

    // 2. Queue the status update event
    const payload = {
      event: 'message.status_update',
      data: {
        inbox_id: inboxId,
        wa_message_id: waMsgId,
        source_id: '628999999123@s.whatsapp.net',
        status: 'read',
        timestamp: Math.floor(Date.now() / 1000)
      }
    };

    payloadQueue.push(payload);
    queueEmitter.emit('push');

    // 3. Wait a moment for worker to process the database update
    await new Promise(resolve => setTimeout(resolve, 150));

    // 4. Verify message status has updated in DB
    const [updatedMsg] = await sql`SELECT status FROM messages WHERE id = ${messageId}`;
    expect(updatedMsg).toBeDefined();
    expect(updatedMsg.status).toBe('read');
  });

  it('should update message status and wa_message_id using internal_message_id (Priority 1)', async () => {
    // 1. Create a test outgoing message with 'sent' status and NO wa_message_id
    const [msg] = await sql`
      INSERT INTO messages (account_id, conversation_id, sender_type, content, message_type, status)
      VALUES (${tenantId}, ${convId}, 'User', 'Hello Status 2', 'outgoing', 'sent')
      RETURNING id
    `;
    const messageId = Number(msg.id);

    // 2. Queue the status update event with internal_message_id
    const newWaId = 'wa_msg_internal_456';
    const payload = {
      event: 'message.status_update',
      data: {
        inbox_id: inboxId,
        wa_message_id: newWaId,
        source_id: '628999999123@s.whatsapp.net',
        status: 'delivered',
        internal_message_id: messageId,
        timestamp: Math.floor(Date.now() / 1000)
      }
    };

    payloadQueue.push(payload);
    queueEmitter.emit('push');

    // 3. Wait a moment for worker to process
    await new Promise(resolve => setTimeout(resolve, 150));

    // 4. Verify message status and wa_message_id in DB
    const [updatedMsg] = await sql`SELECT status, wa_message_id FROM messages WHERE id = ${messageId}`;
    expect(updatedMsg).toBeDefined();
    expect(updatedMsg.status).toBe('delivered');
    expect(updatedMsg.wa_message_id).toBe(newWaId);
  });

  it('should not downgrade message status (e.g. from read to delivered)', async () => {
    // 1. Create a test outgoing message with 'read' status
    const waMsgId = 'wa_msg_downgrade_789';
    const [msg] = await sql`
      INSERT INTO messages (account_id, conversation_id, sender_type, content, message_type, wa_message_id, status)
      VALUES (${tenantId}, ${convId}, 'User', 'Hello Status 3', 'outgoing', ${waMsgId}, 'read')
      RETURNING id
    `;
    const messageId = Number(msg.id);

    // 2. Queue a downgrade status update (read -> delivered)
    const payload = {
      event: 'message.status_update',
      data: {
        inbox_id: inboxId,
        wa_message_id: waMsgId,
        source_id: '628999999123@s.whatsapp.net',
        status: 'delivered',
        timestamp: Math.floor(Date.now() / 1000)
      }
    };

    payloadQueue.push(payload);
    queueEmitter.emit('push');

    // 3. Wait a moment
    await new Promise(resolve => setTimeout(resolve, 150));

    // 4. Verify message status remains 'read'
    const [updatedMsg] = await sql`SELECT status FROM messages WHERE id = ${messageId}`;
    expect(updatedMsg).toBeDefined();
    expect(updatedMsg.status).toBe('read'); // Must stay 'read'
  });
});
