import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { apiKeysRoutes } from '../src/routes/api_keys';
import { JWT_SECRET } from '../src/middleware/auth';
import { sign } from 'hono/jwt';
import crypto from 'crypto';

describe('API Key Creation Security - Admin Gated (Issue #55)', () => {
  let testAccountId: number;
  let testAdminUserId: number;
  let testAgentUserId: number;
  
  let adminToken: string;
  let agentToken: string;

  beforeAll(async () => {
    // Reset sequences
    await sql`SELECT setval('accounts_id_seq', COALESCE((SELECT MAX(id) FROM accounts), 1), true)`;
    await sql`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), true)`;
    await sql`SELECT setval('api_keys_id_seq', COALESCE((SELECT MAX(id) FROM api_keys), 1), true)`;

    // 1. Create a test account
    const [account] = await sql`INSERT INTO accounts (name) VALUES ('API Keys Test Account') RETURNING id`;
    testAccountId = Number(account.id);

    // 2. Create an admin user
    const adminEmail = `admin_${crypto.randomBytes(4).toString('hex')}@keys.local`;
    const [adminUser] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Test Admin', ${adminEmail}, 'dummy_hash')
      RETURNING id
    `;
    testAdminUserId = Number(adminUser.id);

    // Bind Admin User to Account as administrator
    await sql`
      INSERT INTO account_users (account_id, user_id, role)
      VALUES (${testAccountId}, ${testAdminUserId}, 'administrator')
    `;

    // 3. Create an agent user
    const agentEmail = `agent_${crypto.randomBytes(4).toString('hex')}@keys.local`;
    const [agentUser] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Test Agent', ${agentEmail}, 'dummy_hash')
      RETURNING id
    `;
    testAgentUserId = Number(agentUser.id);

    // Bind Agent User to Account as agent
    await sql`
      INSERT INTO account_users (account_id, user_id, role)
      VALUES (${testAccountId}, ${testAgentUserId}, 'agent')
    `;

    // Generate JWT Tokens
    const adminPayload = {
      id: testAdminUserId,
      name: 'Test Admin',
      email: adminEmail,
      account_id: testAccountId,
      role: 'administrator',
      exp: Math.floor(Date.now() / 1000) + 60 * 60
    };
    adminToken = await sign(adminPayload, JWT_SECRET);

    const agentPayload = {
      id: testAgentUserId,
      name: 'Test Agent',
      email: agentEmail,
      account_id: testAccountId,
      role: 'agent',
      exp: Math.floor(Date.now() / 1000) + 60 * 60
    };
    agentToken = await sign(agentPayload, JWT_SECRET);
  });

  afterAll(async () => {
    if (testAccountId) {
      await sql`DELETE FROM api_keys WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM account_users WHERE account_id = ${testAccountId}`;
      if (testAdminUserId) {
        await sql`DELETE FROM users WHERE id = ${testAdminUserId}`;
      }
      if (testAgentUserId) {
        await sql`DELETE FROM users WHERE id = ${testAgentUserId}`;
      }
      await sql`DELETE FROM accounts WHERE id = ${testAccountId}`;
    }
  });

  it('should successfully create an API key when authenticated as an administrator', async () => {
    const response = await apiKeysRoutes.request('/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Admin API Key',
        permissions: ['chatbot.read']
      })
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Admin API Key');
    expect(body.data.plaintext_key).toBeDefined();
  });

  it('should reject API key creation with 403 when authenticated as a normal agent', async () => {
    const response = await apiKeysRoutes.request('/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${agentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Agent API Key',
        permissions: ['chatbot.read']
      })
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Admin only');
  });

  it('should reject API key creation when using an API Key instead of JWT', async () => {
    const response = await apiKeysRoutes.request('/', {
      method: 'POST',
      headers: {
        'X-API-Key': 'some_key',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Nested Key',
        permissions: []
      })
    });

    expect(response.status).toBe(401);
  });
});
