import postgres from 'postgres';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env') });

const sql = postgres(process.env.DATABASE_URL || 'postgres://postgres:password_anda@localhost:5432/omnichannel');

async function runMigration() {
  console.log('Menjalankan migrasi untuk Chatbot Engine...');
  try {
    await sql`
      ALTER TABLE conversations 
      ADD COLUMN IF NOT EXISTS is_bot_active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS bot_state VARCHAR(255) DEFAULT 'start';
    `;
    console.log('Kolom is_bot_active dan bot_state berhasil ditambahkan ke tabel conversations.');
  } catch (err) {
    console.error('Migrasi gagal:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();