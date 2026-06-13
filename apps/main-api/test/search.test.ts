import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { searchRoutes } from '../src/routes/search';
import { contactsRoutes } from '../src/routes/contacts';
import { authRoutes } from '../src/routes/auth';
import crypto from 'crypto';

describe('Full-Text Search Endpoints Integration Tests', () => {
  let testAccountId: number;
  let testUserId: number;
  let testUserEmail: string;
  let testUserPassword = 'supersecretpassword123';
  let jwtToken: string;

  let testChannelId: number;
  let testInboxId: number;
  let testContactId1: number;
  let testContactId2: number;
  let testConversationId1: number;
  let testConversationId2: number;

  beforeAll(async () => {
    // Reset sequences
    await sql`SELECT setval('accounts_id_seq', COALESCE((SELECT MAX(id) FROM accounts), 1), true)`;
    await sql`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), true)`;
    await sql`SELECT setval('channels_id_seq', COALESCE((SELECT MAX(id) FROM channels), 1), true)`;
    await sql`SELECT setval('inboxes_id_seq', COALESCE((SELECT MAX(id) FROM inboxes), 1), true)`;
    await sql`SELECT setval('contacts_id_seq', COALESCE((SELECT MAX(id) FROM contacts), 1), true)`;
    await sql`SELECT setval('conversations_id_seq', COALESCE((SELECT MAX(id) FROM conversations), 1), true)`;
    await sql`SELECT setval('messages_id_seq', COALESCE((SELECT MAX(id) FROM messages), 1), true)`;

    // 1. Create Account
    const [account] = await sql`INSERT INTO accounts (name) VALUES ('FTS Test Account') RETURNING id`;
    testAccountId = Number(account.id);

    // 2. Create User
    testUserEmail = `agent_${crypto.randomBytes(4).toString('hex')}@fts.local`;
    const passwordHash = await Bun.password.hash(testUserPassword);
    const [user] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('FTS Agent', ${testUserEmail}, ${passwordHash})
      RETURNING id
    `;
    testUserId = Number(user.id);

    // 3. Bind User to Account
    await sql`
      INSERT INTO account_users (account_id, user_id, role)
      VALUES (${testAccountId}, ${testUserId}, 'administrator')
    `;

    // 4. Create Channel & Inbox
    const [channel] = await sql`
      INSERT INTO channels (account_id, name, provider_type, provider_config)
      VALUES (${testAccountId}, 'FTS Channel', 'whatsapp', '{}'::jsonb)
      RETURNING id
    `;
    testChannelId = Number(channel.id);

    const [inbox] = await sql`
      INSERT INTO inboxes (account_id, channel_id, name)
      VALUES (${testAccountId}, ${testChannelId}, 'FTS Inbox')
      RETURNING id
    `;
    testInboxId = Number(inbox.id);

    // 5. Create Contacts
    const [contact1] = await sql`
      INSERT INTO contacts (account_id, name, phone_number, email)
      VALUES (${testAccountId}, 'Wardi Wijaya', '6281234567890', 'wardi@fts.local')
      RETURNING id
    `;
    testContactId1 = Number(contact1.id);

    const [contact2] = await sql`
      INSERT INTO contacts (account_id, name, phone_number, email)
      VALUES (${testAccountId}, 'Budi Santoso', '6289999999999', 'budi@fts.local')
      RETURNING id
    `;
    testContactId2 = Number(contact2.id);

    // 6. Create Conversations
    const [conv1] = await sql`
      INSERT INTO conversations (account_id, inbox_id, contact_id)
      VALUES (${testAccountId}, ${testInboxId}, ${testContactId1})
      RETURNING id
    `;
    testConversationId1 = Number(conv1.id);

    const [conv2] = await sql`
      INSERT INTO conversations (account_id, inbox_id, contact_id)
      VALUES (${testAccountId}, ${testInboxId}, ${testContactId2})
      RETURNING id
    `;
    testConversationId2 = Number(conv2.id);

    // 7. Create Messages
    await sql`
      INSERT INTO messages (account_id, conversation_id, sender_type, content, message_type)
      VALUES 
        (${testAccountId}, ${testConversationId1}, 'Contact', 'Halo admin, saya butuh bantuan mengenai pengiriman barang', 'incoming'),
        (${testAccountId}, ${testConversationId1}, 'User', 'Halo Pak Wardi, ada yang bisa kami bantu hari ini?', 'outgoing'),
        (${testAccountId}, ${testConversationId2}, 'Contact', 'Bagaimana cara melakukan pembayaran tagihan?', 'incoming')
    `;

    // 8. Log in to get token
    const randomIp = `10.10.10.${crypto.randomInt(1, 254)}`;
    const loginResponse = await authRoutes.request('/login', {
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
    const loginBody = await loginResponse.json();
    jwtToken = loginBody.token;
  });

  afterAll(async () => {
    if (testAccountId) {
      await sql`DELETE FROM messages WHERE account_id = ${testAccountId}`;
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

  describe('Search Endpoints (FTS)', () => {
    it('should find contact using prefix search on name', async () => {
      const response = await searchRoutes.request('/?type=contacts&q=Ward', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      expect(response.status).toBe(200);
      const res = await response.json();
      expect(res.success).toBe(true);
      expect(res.data.results.contacts.total).toBe(1);
      expect(res.data.results.contacts.data[0].name).toBe('Wardi Wijaya');
    });

    it('should find contact using prefix search on phone number', async () => {
      const response = await searchRoutes.request('/?type=contacts&q=628999', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      expect(response.status).toBe(200);
      const res = await response.json();
      expect(res.success).toBe(true);
      expect(res.data.results.contacts.total).toBe(1);
      expect(res.data.results.contacts.data[0].name).toBe('Budi Santoso');
    });

    it('should find contact using search on email', async () => {
      const response = await searchRoutes.request('/?type=contacts&q=wardi@fts.local', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      expect(response.status).toBe(200);
      const res = await response.json();
      expect(res.success).toBe(true);
      expect(res.data.results.contacts.total).toBe(1);
      expect(res.data.results.contacts.data[0].name).toBe('Wardi Wijaya');
    });

    it('should search messages using indonesian stemming (e.g. "bantuan")', async () => {
      const response = await searchRoutes.request('/?type=messages&q=bantu', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      expect(response.status).toBe(200);
      const res = await response.json();
      expect(res.success).toBe(true);
      expect(res.data.results.messages.total).toBe(2);
      expect(res.data.results.messages.data[0].content).toContain('butuh bantuan');
      expect(res.data.results.messages.data[0].headline).toContain('<mark>');
    });

    it('should search conversations by contact details', async () => {
      const response = await searchRoutes.request('/?type=conversations&q=Budi', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      expect(response.status).toBe(200);
      const res = await response.json();
      expect(res.success).toBe(true);
      expect(res.data.results.conversations.total).toBe(1);
      expect(res.data.results.conversations.data[0].contact_name).toBe('Budi Santoso');
    });
  });

  describe('Contacts CRM Search Endpoint', () => {
    it('should return search results for contacts CRM endpoint', async () => {
      const response = await contactsRoutes.request('/?q=Ward', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      expect(response.status).toBe(200);
      const res = await response.json();
      expect(res.data).toBeDefined();
      expect(res.data.length).toBe(1);
      expect(res.data[0].name).toBe('Wardi Wijaya');
    });

    it('should return all contacts if search query is empty', async () => {
      const response = await contactsRoutes.request('/', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      expect(response.status).toBe(200);
      const res = await response.json();
      expect(res.data).toBeDefined();
      expect(res.data.length).toBe(2);
    });
  });
});
