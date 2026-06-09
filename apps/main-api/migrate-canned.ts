// @ts-nocheck
import postgres from 'postgres';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env') });

const sql = postgres(process.env.DATABASE_URL || 'postgres://postgres:password_anda@localhost:5432/omnichannel');

async function runMigration() {
  console.log('Menjalankan migrasi untuk Canned Responses...');
  try {
    // Buat tabel canned_responses
    await sql`
      CREATE TABLE IF NOT EXISTS canned_responses (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          short_code VARCHAR(50) NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (account_id, short_code)
      );
    `;
    console.log('Tabel canned_responses berhasil dibuat.');

    // Masukkan data bawaan (Seed)
    await sql`
      INSERT INTO canned_responses (account_id, short_code, content)
      VALUES 
        (1, 'salam', 'Halo! Terima kasih telah menghubungi layanan pelanggan kami. Ada yang bisa kami bantu hari ini?'),
        (1, 'jamkerja', 'Jam operasional kami adalah Senin-Jumat dari pukul 09.00 hingga 17.00 WIB.'),
        (1, 'tunggu', 'Mohon tunggu sebentar ya, kami sedang memeriksa detail pesanan Anda.'),
        (1, 'selesai', 'Terima kasih telah menghubungi kami. Jika ada pertanyaan lain, jangan ragu untuk bertanya kembali! Semoga hari Anda menyenangkan.')
      ON CONFLICT (account_id, short_code) DO NOTHING;
    `;
    console.log('Data bawaan (seed) berhasil dimasukkan.');

  } catch (err) {
    console.error('Migrasi gagal:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();