import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL || 'postgres://omni:3aa53cec161c587e51555bdfa5c56eff@localhost:5432/omni';
const sql = postgres(databaseUrl);

async function runMigration() {
  console.log('Menjalankan migrasi untuk Chatbot configs...');
  try {
    // 1. Create chatbot_configs table
    await sql`
      CREATE TABLE IF NOT EXISTS chatbot_configs (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          inbox_id BIGINT REFERENCES inboxes(id) ON DELETE SET NULL,
          name VARCHAR(255) NOT NULL DEFAULT 'Default Bot',
          config JSONB NOT NULL DEFAULT '{}'::jsonb,
          editor_metadata JSONB DEFAULT '{}'::jsonb,
          is_active BOOLEAN DEFAULT FALSE,
          version INTEGER DEFAULT 1,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log('Tabel chatbot_configs berhasil dibuat atau sudah ada.');

    // 2. Create chatbot_config_versions table
    await sql`
      CREATE TABLE IF NOT EXISTS chatbot_config_versions (
          id BIGSERIAL PRIMARY KEY,
          chatbot_config_id BIGINT NOT NULL REFERENCES chatbot_configs(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          config JSONB NOT NULL,
          editor_metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (chatbot_config_id, version)
      );
    `;
    console.log('Tabel chatbot_config_versions berhasil dibuat atau sudah ada.');

    console.log('Migrasi Chatbot configs sukses!');
  } catch (err) {
    console.error('Migrasi gagal:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();