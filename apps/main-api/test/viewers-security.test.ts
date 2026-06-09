import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { conversationsRoutes } from '../src/routes/conversations';
import { JWT_SECRET } from '../src/middleware/auth';
import { sign } from 'hono/jwt';
import crypto from 'crypto';

describe('Conversations Viewers Endpoint Security (Issue #60)', () => {
  let tenant1AccountId: number;
  let tenant2AccountId: number;

  let tenant1AgentUserId: number;
  let tenant2AgentUserId: number;

  let tenant1ConversationId: number;

  let tenant1Token: string;
  let tenant2Token: string;

  beforeAll(async () => {
    // Reset sequences
    await sql`SELECT setval('accounts_id_seq', COALESCE((SELECT MAX(id) FROM accounts), 1), true)`;
    await sql`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), true)`;
    await sql`SELECT setval('conversations_id_seq', COALESCE((SELECT MAX(id) FROM conversations), 1), true)`;

    // 1. Create accounts
    const [account1] = await sql`INSERT INTO accounts (name) VALUES ('Tenant 1') RETURNING id`;
    tenant1AccountId = Number(account1.id);
    const [account2] = await sql`INSERT INTO accounts (name) VALUES ('Tenant 2') RETURNING id`;
    tenant2AccountId = Number(account2.id);

    // 2. Create users
    const email1 = `agent1_${crypto.randomBytes(4).toString('hex')}@viewers.local`;
    const [user1] = await sql`INSERT INTO users (name, email, password_hash) VALUES ('Agent 1', ${email1}, 'dummy') RETURNING id`;
    tenant1AgentUserId = Number(user1.id);

    const email2 = `agent2_${crypto.randomBytes(4).toString('hex')}@viewers.local`;
    const [user2] = await sql`INSERT INTO users (name, email, password_hash) VALUES ('Agent 2', ${email2}, 'dummy') RETURNING id`;
    tenant2AgentUserId = Number(user2.id);

    // Bind users to accounts
    await sql`INSERT INTO account_users (account_id, user_id, role) VALUES (${tenant1AccountId}, ${tenant1AgentUserId}, 'agent')`;
    await sql`INSERT INTO account_users (account_id, user_id, role) VALUES (${tenant2AccountId}, ${tenant2AgentUserId}, 'agent')`;

    // 3. Create a conversation for Tenant 1
    const [channel] = await sql`
      INSERT INTO channels (account_id, name, provider_type, provider_config)
      VALUES (${tenant1AccountId}, 'T1 Channel', 'whatsapp', '{}')
      RETURNING id
    `;
    const [inbox] = await sql`
      INSERT INTO inboxes (account_id, channel_id, name)
      VALUES (${tenant1AccountId}, ${channel.id}, 'T1 Inbox')
      RETURNING id
    `;
    const [contact] = await sql`
      INSERT INTO contacts (account_id, name, phone_number)
      VALUES (${tenant1AccountId}, 'Customer T1', '62811111111')
      RETURNING id
    `;
    const [conv] = await sql`
      INSERT INTO conversations (account_id, inbox_id, contact_id)
      VALUES (${tenant1AccountId}, ${inbox.id}, ${contact.id})
      RETURNING id
    `;
    tenant1ConversationId = Number(conv.id);

    // Generate JWT Tokens
    tenant1Token = await sign({
      id: tenant1AgentUserId,
      account_id: tenant1AccountId,
      role: 'agent',
      exp: Math.floor(Date.now() / 1000) + 3600
    }, JWT_SECRET);

    tenant2Token = await sign({
      id: tenant2AgentUserId,
      account_id: tenant2AccountId,
      role: 'agent',
      exp: Math.floor(Date.now() / 1000) + 3600
    }, JWT_SECRET);

    // Put mock active viewer in Redis for Tenant 1's conversation
    const { redis } = await import('../src/config/redis');
    const key = `viewing:conversation:${tenant1ConversationId}`;
    await redis.zadd(key, Date.now(), JSON.stringify({ userId: tenant1AgentUserId, name: 'Agent 1' }));
  });

  afterAll(async () => {
    // Cleanup Redis
    const { redis } = await import('../src/config/redis');
    await redis.del(`viewing:conversation:${tenant1ConversationId}`);

    // Cleanup DB
    const ids = [tenant1AccountId, tenant2AccountId];
    await sql`DELETE FROM conversations WHERE account_id = ANY(${ids})`;
    await sql`DELETE FROM contacts WHERE account_id = ANY(${ids})`;
    await sql`DELETE FROM inboxes WHERE account_id = ANY(${ids})`;
    await sql`DELETE FROM channels WHERE account_id = ANY(${ids})`;
    await sql`DELETE FROM account_users WHERE account_id = ANY(${ids})`;
    await sql`DELETE FROM users WHERE id = ANY(${[tenant1AgentUserId, tenant2AgentUserId]})`;
    await sql`DELETE FROM accounts WHERE id = ANY(${ids})`;
  });

  it('should successfully retrieve viewers when conversation belongs to the user\'s account (Tenant 1)', async () => {
    const response = await conversationsRoutes.request(`/${tenant1ConversationId}/viewers`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tenant1Token}`
      }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.length).toBe(1);
    expect(body.data[0].userId).toBe(tenant1AgentUserId);
  });

  it('should reject retrieving viewers with 404 when conversation belongs to a different account (Tenant 2)', async () => {
    const response = await conversationsRoutes.request(`/${tenant1ConversationId}/viewers`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tenant2Token}`
      }
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Kontak atau percakapan tidak ditemukan');
  });
});
