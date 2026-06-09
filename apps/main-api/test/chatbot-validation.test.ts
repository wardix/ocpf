import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { chatbotRoutes } from '../src/routes/chatbot';
import crypto from 'crypto';

describe('Chatbot Routes Input Validation', () => {
  let testAccountId: number;
  let testUserId: number;
  let testApiKey: string;

  beforeAll(async () => {
    // Reset sequences
    await sql`SELECT setval('accounts_id_seq', COALESCE((SELECT MAX(id) FROM accounts), 1), true)`;
    await sql`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), true)`;
    await sql`SELECT setval('api_keys_id_seq', COALESCE((SELECT MAX(id) FROM api_keys), 1), true)`;

    // Create a test account
    const [account] = await sql`INSERT INTO accounts (name) VALUES ('Chatbot Validation Test Account') RETURNING id`;
    testAccountId = Number(account.id);

    // Create a test user
    const email = `test_user_${crypto.randomBytes(4).toString('hex')}@validation.local`;
    const [user] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Chatbot Validation User', ${email}, 'dummy_hash')
      RETURNING id
    `;
    testUserId = Number(user.id);

    // Create an API Key for authentication
    testApiKey = 'tok_val_' + crypto.randomBytes(16).toString('hex');
    const keyHash = crypto.createHash('sha256').update(testApiKey).digest('hex');
    await sql`
      INSERT INTO api_keys (account_id, key_hash, key_prefix, name, permissions, created_by)
      VALUES (${testAccountId}, ${keyHash}, 'tok_val', 'Validation Key', ARRAY['chatbot.read', 'chatbot.write']::text[], ${testUserId})
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

  describe('POST /configs/:id/activate', () => {
    const endpoint = '/configs/99999/activate'; // using a dummy ID

    it('should return 400 when is_active is missing', async () => {
      const response = await chatbotRoutes.request(endpoint, {
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
      expect(body.details.is_active).toBeDefined();
    });

    it('should return 400 when is_active is not a boolean (string)', async () => {
      const response = await chatbotRoutes.request(endpoint, {
        method: 'POST',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_active: 'true' }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validasi gagal');
      expect(body.details.is_active).toBeDefined();
    });

    it('should return 400 when is_active is not a boolean (number)', async () => {
      const response = await chatbotRoutes.request(endpoint, {
        method: 'POST',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_active: 1 }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validasi gagal');
      expect(body.details.is_active).toBeDefined();
    });

    it('should pass validation (returning 404 instead of 400) when is_active is true', async () => {
      const response = await chatbotRoutes.request(endpoint, {
        method: 'POST',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_active: true }),
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe('Konfigurasi tidak ditemukan');
    });

    it('should pass validation (returning 404 instead of 400) when is_active is false', async () => {
      const response = await chatbotRoutes.request(endpoint, {
        method: 'POST',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_active: false }),
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe('Konfigurasi tidak ditemukan');
    });
  });

  describe('POST /configs/:id/rollback', () => {
    const endpoint = '/configs/99999/rollback'; // using a dummy ID

    it('should return 400 when version is missing', async () => {
      const response = await chatbotRoutes.request(endpoint, {
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
      expect(body.details.version).toBeDefined();
    });

    it('should return 400 when version is not a number (string)', async () => {
      const response = await chatbotRoutes.request(endpoint, {
        method: 'POST',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version: '5' }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validasi gagal');
      expect(body.details.version).toBeDefined();
    });

    it('should return 400 when version is a negative number', async () => {
      const response = await chatbotRoutes.request(endpoint, {
        method: 'POST',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version: -3 }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validasi gagal');
      expect(body.details.version).toBeDefined();
    });

    it('should return 400 when version is zero', async () => {
      const response = await chatbotRoutes.request(endpoint, {
        method: 'POST',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version: 0 }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validasi gagal');
      expect(body.details.version).toBeDefined();
    });

    it('should return 400 when version is a float', async () => {
      const response = await chatbotRoutes.request(endpoint, {
        method: 'POST',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version: 1.4 }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validasi gagal');
      expect(body.details.version).toBeDefined();
    });

    it('should pass validation (returning 404 instead of 400) when version is a positive integer', async () => {
      const response = await chatbotRoutes.request(endpoint, {
        method: 'POST',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version: 2 }),
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe('Konfigurasi tidak ditemukan');
    });
  });
});
