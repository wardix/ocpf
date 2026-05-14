import postgres from 'postgres';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env') });

const sql = postgres(process.env.DATABASE_URL || 'postgres://postgres:password_anda@localhost:5432/omnichannel');

async function runMigration() {
  console.log('Menjalankan migrasi pemisahan Percakapan dan Tiket...');
  try {
    // Buat tabel tickets
    await sql`
      CREATE TABLE IF NOT EXISTS tickets (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          assignee_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
          status conversation_status DEFAULT 'open',
          is_bot_active BOOLEAN DEFAULT TRUE,
          bot_state VARCHAR(255) DEFAULT 'start',
          snoozed_until TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          resolved_at TIMESTAMP WITH TIME ZONE
      );
    `;
    console.log('Tabel tickets berhasil dibuat.');

    // Tambahkan kolom ticket_id di messages
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE`;
    
    // Tambahkan kolom ticket_id di conversation_events
    await sql`ALTER TABLE conversation_events ADD COLUMN IF NOT EXISTS ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE`;

    console.log('Kolom ticket_id ditambahkan ke messages dan conversation_events.');

    // Kita tidak langsung DROP kolom di conversations agar aplikasi tidak langsung crash.
    // Kolom-kolom lama di conversations (status, assignee_id, dll) akan diabaikan saja mulai sekarang.

  } catch (err) {
    console.error('Migrasi gagal:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();