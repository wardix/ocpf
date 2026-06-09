import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { exportsRoutes } from '../src/routes/exports';
import { JWT_SECRET } from '../src/middleware/auth';
import { sign } from 'hono/jwt';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

describe('Exports Download Path Traversal Security (Issue #63)', () => {
  let testAccountId: number;
  let testUserId: number;
  let testToken: string;

  let validJobId: number;
  let malformedJobId: number;

  const exportsDir = path.resolve(process.cwd(), 'exports');
  const dummyFilePath = path.join(exportsDir, 'valid_test_export.csv');
  const sensitiveFilePath = path.resolve(process.cwd(), 'package.json'); // Valid file, but outside 'exports' dir

  beforeAll(async () => {
    // Reset sequences
    await sql`SELECT setval('accounts_id_seq', COALESCE((SELECT MAX(id) FROM accounts), 1), true)`;
    await sql`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), true)`;
    await sql`SELECT setval('export_jobs_id_seq', COALESCE((SELECT MAX(id) FROM export_jobs), 1), true)`;

    // 1. Create account & user
    const [account] = await sql`INSERT INTO accounts (name) VALUES ('Exports Security Test Account') RETURNING id`;
    testAccountId = Number(account.id);

    const email = `agent_${crypto.randomBytes(4).toString('hex')}@exports.local`;
    const [user] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Exports Agent', ${email}, 'dummy')
      RETURNING id
    `;
    testUserId = Number(user.id);

    await sql`
      INSERT INTO account_users (account_id, user_id, role)
      VALUES (${testAccountId}, ${testUserId}, 'agent')
    `;

    testToken = await sign({
      id: testUserId,
      account_id: testAccountId,
      role: 'agent',
      exp: Math.floor(Date.now() / 1000) + 3600
    }, JWT_SECRET);

    // Create dummy files
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }
    fs.writeFileSync(dummyFilePath, 'id,name\n1,Test Export\n');

    // 2. Create valid Completed Job in exports/
    const [validJob] = await sql`
      INSERT INTO export_jobs (
        account_id, export_type, export_format, status, file_path, row_count, progress_percent, expires_at, created_by
      ) VALUES (
        ${testAccountId}, 'conversations', 'csv', 'completed', ${dummyFilePath}, 1, 100, NOW() + INTERVAL '1 hour', ${testUserId}
      ) RETURNING id
    `;
    validJobId = Number(validJob.id);

    // 3. Create malformed Completed Job targeting file outside exports/ (Path Traversal Simulation)
    const [malformedJob] = await sql`
      INSERT INTO export_jobs (
        account_id, export_type, export_format, status, file_path, row_count, progress_percent, expires_at, created_by
      ) VALUES (
        ${testAccountId}, 'conversations', 'csv', 'completed', ${sensitiveFilePath}, 1, 100, NOW() + INTERVAL '1 hour', ${testUserId}
      ) RETURNING id
    `;
    malformedJobId = Number(malformedJob.id);
  });

  afterAll(async () => {
    // Cleanup files
    if (fs.existsSync(dummyFilePath)) {
      fs.unlinkSync(dummyFilePath);
    }

    // Cleanup DB
    if (testAccountId) {
      await sql`DELETE FROM export_jobs WHERE account_id = ${testAccountId}`;
      await sql`DELETE FROM account_users WHERE account_id = ${testAccountId}`;
      if (testUserId) {
        await sql`DELETE FROM users WHERE id = ${testUserId}`;
      }
      await sql`DELETE FROM accounts WHERE id = ${testAccountId}`;
    }
  });

  it('should successfully download file when the path is valid (inside exports directory)', async () => {
    const response = await exportsRoutes.request(`/${validJobId}/download`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${testToken}`
      }
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('id,name');
  });

  it('should block download and return 403 when the path points outside exports directory', async () => {
    const response = await exportsRoutes.request(`/${malformedJobId}/download`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${testToken}`
      }
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Invalid file path');
  });
});
