import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { redis } from '../src/config/redis';
import { encrypt, decrypt } from '../src/utils/crypto';
import { callAI } from '../src/utils/ai';

describe('AI Assistant System Helpers & Logic', () => {
  const testAccountId = 1;
  let backupConfig: any = null;

  beforeAll(async () => {
    // Ensure Account 1 exists
    await sql`INSERT INTO accounts (id, name) VALUES (${testAccountId}, 'Default Test Account') ON CONFLICT (id) DO NOTHING`;
    
    // Reset sequences and backup existing config
    await sql`SELECT setval('ai_configs_id_seq', COALESCE((SELECT MAX(id) FROM ai_configs), 1), true)`;
    
    const [existing] = await sql`SELECT * FROM ai_configs WHERE account_id = ${testAccountId}`;
    if (existing) {
      backupConfig = existing;
      await sql`DELETE FROM ai_configs WHERE account_id = ${testAccountId}`;
    }
  });

  afterAll(async () => {
    // Clean up test config
    await sql`DELETE FROM ai_configs WHERE account_id = ${testAccountId}`;
    
    // Restore backup
    if (backupConfig) {
      await sql`
        INSERT INTO ai_configs (account_id, provider, api_key_encrypted, model, max_tokens, temperature, is_active, features_enabled)
        VALUES (
          ${testAccountId}, ${backupConfig.provider}, ${backupConfig.api_key_encrypted}, ${backupConfig.model},
          ${backupConfig.max_tokens}, ${backupConfig.temperature}, ${backupConfig.is_active}, ${backupConfig.features_enabled}
        )
      `;
    }
  });

  it('should encrypt and decrypt values correctly', () => {
    const originalText = 'sk-or-gemini-apikey-12345';
    const encryptedText = encrypt(originalText);
    
    expect(encryptedText).not.toBe(originalText);
    expect(encryptedText).toContain(':');
    
    const decryptedText = decrypt(encryptedText);
    expect(decryptedText).toBe(originalText);
  });

  it('should fail with AI_NOT_CONFIGURED when no config exists', async () => {
    expect(
      callAI(testAccountId, 1, 'smart_reply', 'test prompt')
    ).rejects.toThrow('AI_NOT_CONFIGURED');
  });

  it('should fail with AI_FEATURE_DISABLED when feature is not enabled', async () => {
    const encryptedKey = encrypt('mock-key');
    
    await sql`
      INSERT INTO ai_configs (account_id, provider, api_key_encrypted, model, features_enabled, is_active)
      VALUES (${testAccountId}, 'openai', ${encryptedKey}, 'gpt-4o-mini', ARRAY['smart_reply'], true)
    `;

    expect(
      callAI(testAccountId, 1, 'summarize', 'test prompt')
    ).rejects.toThrow('AI_FEATURE_DISABLED');
  });

  it('should enforce rate limiting and throw AI_RATE_LIMIT_EXCEEDED after 50 calls', async () => {
    const hourlyKey = `ai_limit:${testAccountId}:${new Date().getUTCHours()}`;
    
    // Seed rate limit to 50 calls
    await redis.set(hourlyKey, 50);

    expect(
      callAI(testAccountId, 1, 'smart_reply', 'test prompt')
    ).rejects.toThrow('AI_RATE_LIMIT_EXCEEDED');

    // Clean up key
    await redis.del(hourlyKey);
  });
});
