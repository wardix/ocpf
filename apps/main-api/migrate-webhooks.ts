import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL || 'postgres://omni:3aa53cec161c587e51555bdfa5c56eff@localhost:5432/omni';
const sql = postgres(databaseUrl);

async function runMigration() {
  console.log('Menjalankan migrasi untuk Outbound Webhook System...');
  try {
    // 1. Create webhooks table
    await sql`
      CREATE TABLE IF NOT EXISTS webhooks (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          url VARCHAR(2048) NOT NULL,
          events TEXT[] NOT NULL DEFAULT '{}', 
          secret VARCHAR(255) NOT NULL,
          active BOOLEAN DEFAULT TRUE,
          description VARCHAR(500),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log('Tabel webhooks berhasil dibuat atau sudah ada.');

    // 2. Create webhook_delivery_logs table
    await sql`
      CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
          id BIGSERIAL PRIMARY KEY,
          webhook_id BIGINT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
          event_type VARCHAR(50) NOT NULL,
          payload JSONB NOT NULL,
          response_status INTEGER,
          response_body TEXT,
          attempt INTEGER DEFAULT 1,
          delivered_at TIMESTAMP WITH TIME ZONE,
          error_message TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log('Tabel webhook_delivery_logs berhasil dibuat atau sudah ada.');

    // 3. Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_webhooks_account_id ON webhooks(account_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(active) WHERE active = true`;
    await sql`CREATE INDEX IF NOT EXISTS idx_webhook_delivery_logs_webhook_id ON webhook_delivery_logs(webhook_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_webhook_delivery_logs_created_at ON webhook_delivery_logs(created_at DESC)`;
    console.log('Index-index tabel webhook berhasil dibuat atau sudah ada.');

    console.log('Migrasi Webhook sukses!');
  } catch (err) {
    console.error('Migrasi gagal:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();
