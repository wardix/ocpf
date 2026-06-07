import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL || 'postgres://omni:3aa53cec161c587e51555bdfa5c56eff@localhost:5432/omni';
const sql = postgres(databaseUrl);

async function runMigration() {
  console.log('Menjalankan migrasi database untuk widget...');
  console.log('Using Database URL:', databaseUrl);
  try {
    // 1. Add widget_config to inboxes if not exists
    const [columnExists] = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'inboxes' AND column_name = 'widget_config'
    `;
    
    if (!columnExists) {
      console.log('Menambahkan kolom widget_config ke tabel inboxes...');
      await sql`ALTER TABLE inboxes ADD COLUMN widget_config JSONB DEFAULT '{}'::jsonb`;
    } else {
      console.log('Kolom widget_config sudah ada di tabel inboxes.');
    }

    // 2. Create widget_sessions table
    console.log('Membuat tabel widget_sessions...');
    await sql`
      CREATE TABLE IF NOT EXISTS widget_sessions (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          inbox_id BIGINT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
          contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
          conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          fingerprint VARCHAR(64) NOT NULL,
          session_token VARCHAR(128) NOT NULL,
          ip_address INET,
          user_agent TEXT,
          page_url TEXT,
          last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 3. Create unique index
    console.log('Membuat unique index untuk widget_sessions session_token...');
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_widget_sessions_token ON widget_sessions(session_token);
    `;

    console.log('Migrasi widget sukses!');
  } catch (err) {
    console.error('Migrasi widget gagal:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();
