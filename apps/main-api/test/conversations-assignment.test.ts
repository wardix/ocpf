import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { authRoutes } from '../src/routes/auth';
import { conversationsRoutes } from '../src/routes/conversations';
import crypto from 'crypto';

describe('Conversations Assignment & Race Conditions (Issue #84)', () => {
  let testAccountId: number;
  let adminId: number;
  let agent1Id: number;
  let agent2Id: number;
  
  let adminToken: string;
  let agent1Token: string;
  let agent2Token: string;

  let testChannelId: number;
  let testInboxId: number;
  let testContactId: number;
  let testConversationId: number;
  let testTicketId: number;

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
    const [account] = await sql`INSERT INTO accounts (name) VALUES ('Assignment Test Account') RETURNING id`;
    testAccountId = Number(account.id);

    // 2. Create Admin and Agents
    const passwordHash = await Bun.password.hash('secret123');

    const adminEmail = `admin_${crypto.randomBytes(4).toString('hex')}@test.local`;
    const [adminUser] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Admin User', ${adminEmail}, ${passwordHash})
      RETURNING id
    `;
    adminId = Number(adminUser.id);
    await sql`
      INSERT INTO account_users (account_id, user_id, role)
      VALUES (${testAccountId}, ${adminId}, 'administrator')
    `;

    const agent1Email = `agent1_${crypto.randomBytes(4).toString('hex')}@test.local`;
    const [agent1User] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Agent One', ${agent1Email}, ${passwordHash})
      RETURNING id
    `;
    agent1Id = Number(agent1User.id);
    await sql`
      INSERT INTO account_users (account_id, user_id, role)
      VALUES (${testAccountId}, ${agent1Id}, 'agent')
    `;

    const agent2Email = `agent2_${crypto.randomBytes(4).toString('hex')}@test.local`;
    const [agent2User] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Agent Two', ${agent2Email}, ${passwordHash})
      RETURNING id
    `;
    agent2Id = Number(agent2User.id);
    await sql`
      INSERT INTO account_users (account_id, user_id, role)
      VALUES (${testAccountId}, ${agent2Id}, 'agent')
    `;

    // 3. Obtain JWT Tokens via /login
    const loginUser = async (email: string) => {
      const randomIp = `10.10.10.${crypto.randomInt(1, 254)}`;
      const response = await authRoutes.request('/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': randomIp,
        },
        body: JSON.stringify({ email, password: 'secret123' }),
      });
      const body = await response.json();
      if (!body.token) {
        throw new Error(`Failed to login: ${JSON.stringify(body)}`);
      }
      return body.token;
    };

    adminToken = await loginUser(adminEmail);
    agent1Token = await loginUser(agent1Email);
    agent2Token = await loginUser(agent2Email);

    // 4. Create structure (Channel, Inbox, Contact, Conversation)
    const [channel] = await sql`
      INSERT INTO channels (account_id, name, provider_type, provider_config)
      VALUES (${testAccountId}, 'Test Channel', 'whatsapp', '{}'::jsonb)
      RETURNING id
    `;
    testChannelId = Number(channel.id);

    const [inbox] = await sql`
      INSERT INTO inboxes (account_id, channel_id, name)
      VALUES (${testAccountId}, ${testChannelId}, 'Test Inbox')
      RETURNING id
    `;
    testInboxId = Number(inbox.id);

    const [contact] = await sql`
      INSERT INTO contacts (account_id, name, phone_number)
      VALUES (${testAccountId}, 'Contact Test', '62811111111')
      RETURNING id
    `;
    testContactId = Number(contact.id);

    const [conv] = await sql`
      INSERT INTO conversations (account_id, inbox_id, contact_id)
      VALUES (${testAccountId}, ${testInboxId}, ${testContactId})
      RETURNING id
    `;
    testConversationId = Number(conv.id);

    // Create ticket (unassigned)
    const [ticket] = await sql`
      INSERT INTO tickets (account_id, conversation_id, status, assignee_id)
      VALUES (${testAccountId}, ${testConversationId}, 'open', NULL)
      RETURNING id
    `;
    testTicketId = Number(ticket.id);
  });

  afterAll(async () => {
    if (testAccountId) {
      await sql`DELETE FROM messages WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM conversation_events WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM tickets WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM conversations WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM contacts WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM inboxes WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM channels WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM account_users WHERE account_id = ${testAccountId}`;
      const userIds = [adminId, agent1Id, agent2Id].filter(Boolean);
      if (userIds.length > 0) {
        await sql`DELETE FROM users WHERE id = ANY(${userIds})`;
      }
      await sql`DELETE FROM accounts WHERE id = ${testAccountId}`;
    }
  });

  it('should allow Agent 1 to self-assign an unassigned ticket', async () => {
    const response = await conversationsRoutes.request(`/${testConversationId}/assign`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${agent1Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Number(body.data.assignee_id)).toBe(agent1Id);

    // Verify in db
    const [ticket] = await sql`SELECT assignee_id FROM tickets WHERE id = ${testTicketId}`;
    expect(Number(ticket.assignee_id)).toBe(agent1Id);
  });

  it('should reject Agent 2 trying to self-assign the ticket already assigned to Agent 1', async () => {
    const response = await conversationsRoutes.request(`/${testConversationId}/assign`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${agent2Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Tiket sudah diambil agen lain');
  });

  it('should allow Admin to reassign the ticket to Agent 2', async () => {
    const response = await conversationsRoutes.request(`/${testConversationId}/assign`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assignee_id: agent2Id,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Number(body.data.assignee_id)).toBe(agent2Id);

    // Verify in db
    const [ticket] = await sql`SELECT assignee_id FROM tickets WHERE id = ${testTicketId}`;
    expect(Number(ticket.assignee_id)).toBe(agent2Id);
  });

  it('should reject non-admin Agent 1 trying to assign the ticket to Agent 2', async () => {
    const response = await conversationsRoutes.request(`/${testConversationId}/assign`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${agent1Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assignee_id: agent2Id,
      }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Hanya administrator yang boleh memindahkan tiket ke agen lain');
  });

  it('should return 404 NOT_FOUND for non-existent conversation assignment', async () => {
    const response = await conversationsRoutes.request(`/999999/assign`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assignee_id: agent1Id,
      }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Tiket tidak ditemukan');
  });

  it('should simulate concurrent requests and handle db locking correctly', async () => {
    // 1. Reset ticket to unassigned first
    await sql`UPDATE tickets SET assignee_id = NULL WHERE id = ${testTicketId}`;

    // 2. Dispatch two concurrent self-assignment requests (one by Agent 1, one by Agent 2)
    const req1 = conversationsRoutes.request(`/${testConversationId}/assign`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${agent1Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const req2 = conversationsRoutes.request(`/${testConversationId}/assign`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${agent2Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const [res1, res2] = await Promise.all([req1, req2]);

    // One must succeed (200), and the other must fail with ALREADY_ASSIGNED (400)
    const statusCodes = [res1.status, res2.status].sort();
    expect(statusCodes).toEqual([200, 400]);

    const body1 = await res1.json();
    const body2 = await res2.json();

    if (res1.status === 200) {
      expect(body1.success).toBe(true);
      expect(Number(body1.data.assignee_id)).toBe(agent1Id);
      expect(body2.error).toBe('Tiket sudah diambil agen lain');
    } else {
      expect(body2.success).toBe(true);
      expect(Number(body2.data.assignee_id)).toBe(agent2Id);
      expect(body1.error).toBe('Tiket sudah diambil agen lain');
    }
  });
});
