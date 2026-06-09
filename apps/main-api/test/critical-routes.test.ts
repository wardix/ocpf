import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { authRoutes } from '../src/routes/auth';
import { conversationsRoutes } from '../src/routes/conversations';
import { messagesRoutes } from '../src/routes/messages';
import crypto from 'crypto';

describe('Critical API Routes Integration Tests', () => {
  let testAccountId: number;
  let testUserId: number;
  let testUserEmail: string;
  let testUserPassword = 'supersecretpassword123';
  let jwtToken: string;

  let testChannelId: number;
  let testInboxId: number;
  let testContactId: number;
  let testConversationId: number;

  beforeAll(async () => {
    // Reset sequences
    await sql`SELECT setval('accounts_id_seq', COALESCE((SELECT MAX(id) FROM accounts), 1), true)`;
    await sql`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), true)`;
    await sql`SELECT setval('channels_id_seq', COALESCE((SELECT MAX(id) FROM channels), 1), true)`;
    await sql`SELECT setval('inboxes_id_seq', COALESCE((SELECT MAX(id) FROM inboxes), 1), true)`;
    await sql`SELECT setval('contacts_id_seq', COALESCE((SELECT MAX(id) FROM contacts), 1), true)`;
    await sql`SELECT setval('conversations_id_seq', COALESCE((SELECT MAX(id) FROM conversations), 1), true)`;
    await sql`SELECT setval('tickets_id_seq', COALESCE((SELECT MAX(id) FROM tickets), 1), true)`;

    // 1. Create Account
    const [account] = await sql`INSERT INTO accounts (name) VALUES ('Critical Test Account') RETURNING id`;
    testAccountId = Number(account.id);

    // 2. Create User
    testUserEmail = `agent_${crypto.randomBytes(4).toString('hex')}@critical.local`;
    const passwordHash = await Bun.password.hash(testUserPassword);
    const [user] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Critical Agent', ${testUserEmail}, ${passwordHash})
      RETURNING id
    `;
    testUserId = Number(user.id);

    // 3. Bind User to Account
    await sql`
      INSERT INTO account_users (account_id, user_id, role)
      VALUES (${testAccountId}, ${testUserId}, 'administrator')
    `;

    // 4. Create Channel, Inbox, Contact, and Conversation for routing tests
    const [channel] = await sql`
      INSERT INTO channels (account_id, name, provider_type, provider_config)
      VALUES (${testAccountId}, 'Critical Channel', 'whatsapp', '{}'::jsonb)
      RETURNING id
    `;
    testChannelId = Number(channel.id);

    const [inbox] = await sql`
      INSERT INTO inboxes (account_id, channel_id, name)
      VALUES (${testAccountId}, ${testChannelId}, 'Critical Inbox')
      RETURNING id
    `;
    testInboxId = Number(inbox.id);

    const [contact] = await sql`
      INSERT INTO contacts (account_id, name, phone_number)
      VALUES (${testAccountId}, 'Customer One', '62811111111')
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

  describe('Auth Route: /api/auth', () => {
    it('should successfully login and return a JWT token', async () => {
      // Use random IP to bypass login rate limiters
      const randomIp = `10.10.10.${crypto.randomInt(1, 254)}`;
      const response = await authRoutes.request('/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': randomIp,
        },
        body: JSON.stringify({
          email: testUserEmail,
          password: testUserPassword,
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.token).toBeDefined();
      expect(typeof body.token).toBe('string');
      jwtToken = body.token;
    });

    it('should fail to login with wrong credentials', async () => {
      // Use random IP to bypass login rate limiters
      const randomIp = `10.10.10.${crypto.randomInt(1, 254)}`;
      const response = await authRoutes.request('/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': randomIp,
        },
        body: JSON.stringify({
          email: testUserEmail,
          password: 'wrongpassword',
        }),
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Kredensial tidak valid');
    });
  });

  describe('Conversations Route: /api/conversations', () => {
    it('should retrieve conversations list for the authenticated user', async () => {
      expect(jwtToken).toBeDefined();

      const response = await conversationsRoutes.request('/?tab=all', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      expect(response.status).toBe(200);
      const resObj = await response.json();
      expect(resObj.data).toBeDefined();
      expect(Array.isArray(resObj.data)).toBe(true);
      expect(resObj.data.length).toBeGreaterThan(0);
      expect(Number(resObj.data[0].id)).toBe(testConversationId);
    });

    it('should return 401 Unauthorized when accessing conversations without token', async () => {
      const response = await conversationsRoutes.request('/', {
        method: 'GET',
      });
      expect(response.status).toBe(401);
    });
  });

  describe('Messages Route: /api/messages', () => {
    it('should successfully send a text message', async () => {
      expect(jwtToken).toBeDefined();

      const response = await messagesRoutes.request('/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target_id: '62811111111',
          content: 'Hello, this is a test message from integration tests!',
          conversation_id: testConversationId,
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.content).toContain('Hello, this is a test message');
    });

    it('should fail message dispatch with invalid schema (missing content & media)', async () => {
      expect(jwtToken).toBeDefined();

      const response = await messagesRoutes.request('/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target_id: '62811111111',
          conversation_id: testConversationId,
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validasi gagal');
    });
  });
});
