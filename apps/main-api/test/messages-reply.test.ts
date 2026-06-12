import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { authRoutes } from '../src/routes/auth';
import { messagesRoutes } from '../src/routes/messages';
import { redis } from '../src/config/redis';
import crypto from 'crypto';

describe('Messages Quote Reply & WhatsApp Metadata (Issue #117)', () => {
  let testAccountId: number;
  let testUserId: number;
  let testUserEmail: string;
  let jwtToken: string;

  let testChannelId: number;
  let testInboxId: number;
  let testContactId: number;
  let testConversationId: number;
  let incomingMessageId: number;
  const originalWaMessageId = 'gwa-message-id-12345';

  beforeAll(async () => {
    // Reset sequences
    await sql`SELECT setval('accounts_id_seq', COALESCE((SELECT MAX(id) FROM accounts), 1), true)`;
    await sql`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), true)`;
    await sql`SELECT setval('channels_id_seq', COALESCE((SELECT MAX(id) FROM channels), 1), true)`;
    await sql`SELECT setval('inboxes_id_seq', COALESCE((SELECT MAX(id) FROM inboxes), 1), true)`;
    await sql`SELECT setval('contacts_id_seq', COALESCE((SELECT MAX(id) FROM contacts), 1), true)`;
    await sql`SELECT setval('conversations_id_seq', COALESCE((SELECT MAX(id) FROM conversations), 1), true)`;
    await sql`SELECT setval('tickets_id_seq', COALESCE((SELECT MAX(id) FROM tickets), 1), true)`;
    await sql`SELECT setval('messages_id_seq', COALESCE((SELECT MAX(id) FROM messages), 1), true)`;

    // 1. Create Account
    const [account] = await sql`INSERT INTO accounts (name) VALUES ('Reply Test Account') RETURNING id`;
    testAccountId = Number(account.id);

    // 2. Create Agent
    testUserEmail = `agent_${crypto.randomBytes(4).toString('hex')}@reply.local`;
    const passwordHash = await Bun.password.hash('secret123');
    const [user] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Reply Agent', ${testUserEmail}, ${passwordHash})
      RETURNING id
    `;
    testUserId = Number(user.id);

    // Bind User to Account
    await sql`
      INSERT INTO account_users (account_id, user_id, role)
      VALUES (${testAccountId}, ${testUserId}, 'administrator')
    `;

    // 3. Login to get JWT Token
    const randomIp = `10.10.10.${crypto.randomInt(1, 254)}`;
    const loginResponse = await authRoutes.request('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': randomIp,
      },
      body: JSON.stringify({ email: testUserEmail, password: 'secret123' }),
    });
    const loginBody = await loginResponse.json();
    jwtToken = loginBody.token;

    // 4. Create Channel, Inbox, Contact, and Conversation (WhatsApp)
    const [channel] = await sql`
      INSERT INTO channels (account_id, name, provider_type, provider_config)
      VALUES (${testAccountId}, 'WA Reply Channel', 'whatsapp', '{}'::jsonb)
      RETURNING id
    `;
    testChannelId = Number(channel.id);

    const [inbox] = await sql`
      INSERT INTO inboxes (account_id, channel_id, name)
      VALUES (${testAccountId}, ${testChannelId}, 'WA Reply Inbox')
      RETURNING id
    `;
    testInboxId = Number(inbox.id);

    const [contact] = await sql`
      INSERT INTO contacts (account_id, name, phone_number)
      VALUES (${testAccountId}, 'Customer Reply', '6289999999')
      RETURNING id
    `;
    testContactId = Number(contact.id);

    const [conv] = await sql`
      INSERT INTO conversations (account_id, inbox_id, contact_id)
      VALUES (${testAccountId}, ${testInboxId}, ${testContactId})
      RETURNING id
    `;
    testConversationId = Number(conv.id);

    // Create a ticket for the conversation assigned to the test user to avoid 403 Forbidden
    await sql`
      INSERT INTO tickets (account_id, conversation_id, status, assignee_id)
      VALUES (${testAccountId}, ${testConversationId}, 'open', ${testUserId})
    `;

    // 5. Insert an incoming message from the customer
    const [msg] = await sql`
      INSERT INTO messages (account_id, conversation_id, sender_type, sender_id, content, message_type, wa_message_id)
      VALUES (${testAccountId}, ${testConversationId}, 'Contact', ${testContactId}, 'Hello Agent, how are you?', 'incoming', ${originalWaMessageId})
      RETURNING id
    `;
    incomingMessageId = Number(msg.id);
  });

  afterAll(async () => {
    if (testAccountId) {
      await sql`DELETE FROM messages WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM tickets WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM conversations WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM contacts WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM inboxes WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM channels WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM account_users WHERE account_id = ${testAccountId}`;
      if (testUserId) {
        await sql`DELETE FROM users WHERE id = ${testUserId}`;
      }
      await sql`DELETE FROM accounts WHERE id = ${testAccountId}`;
    }
  });

  it('should successfully send a quote reply and include whatsapp_metadata in Redis and Response', async () => {
    const queueName = `queue:outgoing_messages:inbox_${testInboxId}`;
    
    // Clear any previous queued items
    await redis.del(queueName);

    const response = await messagesRoutes.request('/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        target_id: '6289999999@s.whatsapp.net',
        content: 'I am doing great, thank you!',
        conversation_id: testConversationId,
        reply_to_message_id: incomingMessageId,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.reply_to_message_id).toBe(incomingMessageId);
    expect(body.data.whatsapp_metadata).toEqual({
      quoted_wa_id: originalWaMessageId,
      quoted_text: 'Hello Agent, how are you?',
    });

    // Check Redis Queue
    const len = await redis.llen(queueName);
    expect(len).toBe(1);

    const redisItemStr = await redis.lpop(queueName);
    expect(redisItemStr).not.toBeNull();
    const redisItem = JSON.parse(redisItemStr!);
    expect(redisItem.event).toBe('message.send');
    expect(redisItem.data.whatsapp_metadata).toEqual({
      quoted_wa_id: originalWaMessageId,
      quoted_text: 'Hello Agent, how are you?',
    });
  });
});
