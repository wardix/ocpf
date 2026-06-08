import { sql } from './src/config/database';

async function migrate() {
  console.log('Running Message Templates migration...');
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS message_templates (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          body TEXT NOT NULL,
          variables TEXT[] NOT NULL DEFAULT '{}',
          category VARCHAR(100),
          language VARCHAR(10) DEFAULT 'id',
          is_active BOOLEAN DEFAULT TRUE,
          usage_count BIGINT DEFAULT 0,
          created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(account_id, name)
      );
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_message_templates_search 
      ON message_templates USING GIN(to_tsvector('indonesian', name || ' ' || body));
    `;

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    process.exit(0);
  }
}

migrate();
