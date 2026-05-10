import postgres from 'postgres';
import { config } from 'dotenv';
import path from 'path';

// Load .env from apps/main-api
config({ path: path.resolve(process.cwd(), '.env') });

const sql = postgres(process.env.DATABASE_URL || 'postgres://postgres:password_anda@localhost:5432/omnichannel');

async function runMigration() {
  console.log('Menjalankan migrasi database...');
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS conversation_events (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
          conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
          actor_type VARCHAR(50), 
          actor_id BIGINT,        
          event_type VARCHAR(50), 
          event_data JSONB,       
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    
    await sql`
      CREATE INDEX IF NOT EXISTS idx_conversation_events_conv_id ON conversation_events(conversation_id);
    `;
    console.log('Migrasi sukses: Tabel conversation_events berhasil dibuat.');
  } catch (err) {
    console.error('Migrasi gagal:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();