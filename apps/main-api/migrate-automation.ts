import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL || 'postgres://omni:3aa53cec161c587e51555bdfa5c56eff@localhost:5432/omni';
const sql = postgres(databaseUrl);

async function runMigration() {
  console.log('Menjalankan migrasi untuk Automation Rules Engine...');
  try {
    // 1. Create automation_rules table
    await sql`
      CREATE TABLE IF NOT EXISTS automation_rules (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          trigger_type VARCHAR(50) NOT NULL,
          trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
          actions JSONB[] NOT NULL DEFAULT '{}',
          is_active BOOLEAN DEFAULT TRUE,
          priority INT DEFAULT 0,
          execution_count BIGINT DEFAULT 0,
          last_executed_at TIMESTAMP WITH TIME ZONE,
          created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log('Tabel automation_rules berhasil dibuat atau sudah ada.');

    // 2. Create automation_logs table
    await sql`
      CREATE TABLE IF NOT EXISTS automation_logs (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          rule_id BIGINT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
          conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
          ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
          trigger_type VARCHAR(50) NOT NULL,
          trigger_data JSONB,
          actions_executed JSONB[],
          actions_failed JSONB[],
          status VARCHAR(20) NOT NULL DEFAULT 'success',
          execution_time_ms INT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log('Tabel automation_logs berhasil dibuat atau sudah ada.');

    // 3. Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_automation_rules_account_id ON automation_rules(account_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_automation_rules_active ON automation_rules(is_active) WHERE is_active = true`;
    await sql`CREATE INDEX IF NOT EXISTS idx_automation_rules_priority ON automation_rules(priority)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_automation_logs_account_id ON automation_logs(account_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_automation_logs_rule_id ON automation_logs(rule_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_automation_logs_created_at ON automation_logs(created_at DESC)`;
    console.log('Index-index tabel Automation Rules berhasil dibuat atau sudah ada.');

    console.log('Migrasi Automation Rules sukses!');
  } catch (err) {
    console.error('Migrasi gagal:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();
