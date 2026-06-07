import { sql } from './src/config/database';

async function migrate() {
  console.log('Running API Keys migration...');
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS api_keys (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          key_hash VARCHAR(64) NOT NULL,
          key_prefix VARCHAR(20) NOT NULL,
          name VARCHAR(255) NOT NULL,
          permissions TEXT[] NOT NULL DEFAULT '{}',
          last_used_at TIMESTAMP WITH TIME ZONE,
          created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          revoked_at TIMESTAMP WITH TIME ZONE
      );
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
    `;

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    process.exit(0);
  }
}

migrate();
