import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { aiRoutes } from '../src/routes/ai';
import crypto from 'crypto';

describe('AI Routes Input Validation', () => {
  let testAccountId: number;
  let testUserId: number;
  let testApiKey: string;

  beforeAll(async () => {
    // Reset sequences
    await sql`SELECT setval('accounts_id_seq', COALESCE((SELECT MAX(id) FROM accounts), 1), true)`;
    await sql`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), true)`;
    await sql`SELECT setval('api_keys_id_seq', COALESCE((SELECT MAX(id) FROM api_keys), 1), true)`;

    // Create a test account
    const [account] = await sql`INSERT INTO accounts (name) VALUES ('AI Validation Test Account') RETURNING id`;
    testAccountId = Number(account.id);

    // Create a test user
    const email = `test_user_${crypto.randomBytes(4).toString('hex')}@validation.local`;
    const [user] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('AI Validation User', ${email}, 'dummy_hash')
      RETURNING id
    `;
    testUserId = Number(user.id);

    // Create an API Key for authentication
    testApiKey = 'tok_val_' + crypto.randomBytes(16).toString('hex');
    const keyHash = crypto.createHash('sha256').update(testApiKey).digest('hex');
    await sql`
      INSERT INTO api_keys (account_id, key_hash, key_prefix, name, permissions, created_by)
      VALUES (${testAccountId}, ${keyHash}, 'tok_val', 'Validation Key', ARRAY['ai.read', 'ai.write']::text[], ${testUserId})
    `;
  });

  afterAll(async () => {
    if (testAccountId) {
      await sql`DELETE FROM api_keys WHERE account_id = ${testAccountId}`;
      if (testUserId) {
        await sql`DELETE FROM users WHERE id = ${testUserId}`;
      }
      await sql`DELETE FROM accounts WHERE id = ${testAccountId}`;
    }
  });

  const endpoints = ['/suggest', '/summarize', '/categorize'];

  for (const endpoint of endpoints) {
    describe(`Endpoint: POST ${endpoint}`, () => {
      it('should return 400 when conversation_id is missing', async () => {
        const response = await aiRoutes.request(endpoint, {
          method: 'POST',
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('Validasi gagal');
        expect(body.details.conversation_id).toBeDefined();
      });

      it('should return 400 when conversation_id is not a number', async () => {
        const response = await aiRoutes.request(endpoint, {
          method: 'POST',
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ conversation_id: 'invalid-id' }),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('Validasi gagal');
        expect(body.details.conversation_id).toBeDefined();
      });

      it('should return 400 when conversation_id is a negative number', async () => {
        const response = await aiRoutes.request(endpoint, {
          method: 'POST',
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ conversation_id: -5 }),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('Validasi gagal');
        expect(body.details.conversation_id).toBeDefined();
      });

      it('should return 400 when conversation_id is zero', async () => {
        const response = await aiRoutes.request(endpoint, {
          method: 'POST',
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ conversation_id: 0 }),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('Validasi gagal');
        expect(body.details.conversation_id).toBeDefined();
      });

      it('should return 400 when conversation_id is a float', async () => {
        const response = await aiRoutes.request(endpoint, {
          method: 'POST',
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ conversation_id: 1.5 }),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('Validasi gagal');
        expect(body.details.conversation_id).toBeDefined();
      });

      it('should pass validation (returning 404 or other status but not 400 validation error) when conversation_id is a positive integer', async () => {
        const response = await aiRoutes.request(endpoint, {
          method: 'POST',
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ conversation_id: 99999 }), // ID that does not exist in DB
        });

        // Since conversation_id 99999 is valid, it passes Zod validation.
        // It then fails with 404 'Percakapan tidak ditemukan' in the route handler.
        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.error).toBe('Percakapan tidak ditemukan');
      });
    });
  }
});
