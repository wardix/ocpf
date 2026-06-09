import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { app } from '../src/index';

describe('Widget CORS Origin Whitelist Integration Tests (Issue #82)', () => {
  let testAccountId: number;
  let testChannelId: number;
  let testInboxId: number;
  let originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    // Reset sequences to prevent conflicts
    await sql`SELECT setval('accounts_id_seq', COALESCE((SELECT MAX(id) FROM accounts), 1), true)`;
    await sql`SELECT setval('channels_id_seq', COALESCE((SELECT MAX(id) FROM channels), 1), true)`;
    await sql`SELECT setval('inboxes_id_seq', COALESCE((SELECT MAX(id) FROM inboxes), 1), true)`;

    // Create test account
    const [account] = await sql`INSERT INTO accounts (name) VALUES ('Widget CORS Test Account') RETURNING id`;
    testAccountId = Number(account.id);

    // Create test channel
    const [channel] = await sql`
      INSERT INTO channels (account_id, name, provider_type, provider_config)
      VALUES (${testAccountId}, 'Widget CORS Channel', 'web_widget', '{}'::jsonb)
      RETURNING id
    `;
    testChannelId = Number(channel.id);

    // Create test inbox with empty/null widget_config allowed_domains
    const [inbox] = await sql`
      INSERT INTO inboxes (account_id, channel_id, name, widget_config)
      VALUES (${testAccountId}, ${testChannelId}, 'Widget CORS Inbox', '{}'::jsonb)
      RETURNING id
    `;
    testInboxId = Number(inbox.id);
  });

  afterAll(async () => {
    // Restore original NODE_ENV
    process.env.NODE_ENV = originalNodeEnv;

    // Clean up test data
    if (testInboxId) await sql`DELETE FROM inboxes WHERE id = ${testInboxId}`;
    if (testChannelId) await sql`DELETE FROM channels WHERE id = ${testChannelId}`;
    if (testAccountId) await sql`DELETE FROM accounts WHERE id = ${testAccountId}`;
  });

  it('should allow request in development/testing mode when allowed_domains is empty', async () => {
    process.env.NODE_ENV = 'test';
    const response = await app.request(`/api/widget/config?inbox_id=${testInboxId}`, {
      headers: {
        'Origin': 'https://some-external-domain.com'
      }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it('should reject request in production mode when allowed_domains is empty', async () => {
    process.env.NODE_ENV = 'production';
    const response = await app.request(`/api/widget/config?inbox_id=${testInboxId}`, {
      headers: {
        'Origin': 'https://some-external-domain.com'
      }
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Origin website ini tidak diizinkan untuk memuat widget');
  });

  it('should allow request in production mode if allowed_domains contains matching origin', async () => {
    // Update inbox to have allowed_domain
    await sql`
      UPDATE inboxes 
      SET widget_config = '{"allowed_domains": "my-domain.com"}'::jsonb 
      WHERE id = ${testInboxId}
    `;

    process.env.NODE_ENV = 'production';

    // Matching domain
    const response1 = await app.request(`/api/widget/config?inbox_id=${testInboxId}`, {
      headers: {
        'Origin': 'https://my-domain.com'
      }
    });
    expect(response1.status).toBe(200);

    // Matching subdomain
    const response2 = await app.request(`/api/widget/config?inbox_id=${testInboxId}`, {
      headers: {
        'Origin': 'https://sub.my-domain.com'
      }
    });
    expect(response2.status).toBe(200);

    // Non-matching domain
    const response3 = await app.request(`/api/widget/config?inbox_id=${testInboxId}`, {
      headers: {
        'Origin': 'https://evil-domain.com'
      }
    });
    expect(response3.status).toBe(403);
  });
});
