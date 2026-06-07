import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL || 'postgres://omni:3aa53cec161c587e51555bdfa5c56eff@localhost:5432/omni';
const sql = postgres(databaseUrl);

async function runMigration() {
  console.log('Menjalankan migrasi untuk AI Assistant System...');
  try {
    // 1. Create ai_configs table
    await sql`
      CREATE TABLE IF NOT EXISTS ai_configs (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          provider VARCHAR(50) NOT NULL DEFAULT 'openai',
          api_key_encrypted TEXT NOT NULL,
          model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
          max_tokens INT DEFAULT 500,
          temperature NUMERIC(2,1) DEFAULT 0.7,
          is_active BOOLEAN DEFAULT TRUE,
          features_enabled TEXT[] DEFAULT '{smart_reply,summarize,auto_categorize}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(account_id)
      );
    `;
    console.log('Tabel ai_configs berhasil dibuat atau sudah ada.');

    // 2. Create ai_usage_logs table
    await sql`
      CREATE TABLE IF NOT EXISTS ai_usage_logs (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
          feature VARCHAR(50) NOT NULL,
          tokens_input INT NOT NULL DEFAULT 0,
          tokens_output INT NOT NULL DEFAULT 0,
          latency_ms INT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log('Tabel ai_usage_logs berhasil dibuat atau sudah ada.');

    // 3. Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_configs_account_id ON ai_configs(account_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_configs_active ON ai_configs(is_active) WHERE is_active = true`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_account_id ON ai_usage_logs(account_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON ai_usage_logs(created_at DESC)`;
    console.log('Index-index tabel AI berhasil dibuat atau sudah ada.');

    console.log('Migrasi AI Assistant sukses!');
  } catch (err) {
    console.error('Migrasi gagal:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();
