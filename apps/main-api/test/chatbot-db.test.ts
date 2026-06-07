import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { getActiveChatbotRules, clearChatbotCache } from '../src/chatbot/engine';

describe('Chatbot Database and Cache Engine', () => {
  let testInboxId: number;
  let testAccountId = 1;

  beforeAll(async () => {
    // Reset sequences to prevent duplicate key violations if sequence is behind actual records
    await sql`SELECT setval('channels_id_seq', COALESCE((SELECT MAX(id) FROM channels), 1), true)`;
    await sql`SELECT setval('inboxes_id_seq', COALESCE((SELECT MAX(id) FROM inboxes), 1), true)`;

    // 1. Create a dummy inbox linked to a channel for testing
    const [channel] = await sql`
      INSERT INTO channels (account_id, name, provider_type, provider_config)
      VALUES (${testAccountId}, 'Test Bot Channel', 'whatsapp', '{}'::jsonb)
      RETURNING id
    `;

    const [inbox] = await sql`
      INSERT INTO inboxes (account_id, channel_id, name, description)
      VALUES (${testAccountId}, ${channel.id}, 'Test Bot Inbox', 'For chatbot testing')
      RETURNING id
    `;
    testInboxId = Number(inbox.id);
  });

  afterAll(async () => {
    // Clean up created inbox
    if (testInboxId) {
      await sql`DELETE FROM inboxes WHERE id = ${testInboxId}`;
    }
  });

  it('should return null when no chatbot config is active', async () => {
    clearChatbotCache(testInboxId);
    const rules = await getActiveChatbotRules(testInboxId);
    expect(rules).toBeNull();
  });

  it('should retrieve rules from database and cache them', async () => {
    const testConfig = {
      global_commands: { '!menu': 'start' },
      states: {
        start: {
          steps: [{ type: 'text', content: 'Hello test!' }],
          options: { '1': 'info' }
        }
      }
    };

    // Insert active chatbot config
    const [cfg] = await sql`
      INSERT INTO chatbot_configs (account_id, inbox_id, name, config, is_active)
      VALUES (${testAccountId}, ${testInboxId}, 'Test Chatbot', ${testConfig}, true)
      RETURNING id
    `;

    try {
      clearChatbotCache(testInboxId);
      
      // 1st call: DB hit
      const rules1 = await getActiveChatbotRules(testInboxId);
      expect(rules1).not.toBeNull();
      expect(rules1.global_commands['!menu']).toBe('start');

      // Update in DB (without clearing cache) to see if cache is serving old rules
      const updatedConfig = { ...testConfig, global_commands: { '!menu': 'updated' } };
      await sql`
        UPDATE chatbot_configs SET config = ${updatedConfig} WHERE id = ${cfg.id}
      `;

      // 2nd call: cache hit (should return old value)
      const rules2 = await getActiveChatbotRules(testInboxId);
      expect(rules2.global_commands['!menu']).toBe('start');

      // Clear cache
      clearChatbotCache(testInboxId);

      // 3rd call: cache cleared, should return new value
      const rules3 = await getActiveChatbotRules(testInboxId);
      expect(rules3.global_commands['!menu']).toBe('updated');
    } finally {
      // Clean up config
      await sql`DELETE FROM chatbot_configs WHERE id = ${cfg.id}`;
    }
  });
});
