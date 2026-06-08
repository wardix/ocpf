import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL || 'postgres://omni:3aa53cec161c587e51555bdfa5c56eff@localhost:5432/omni';
const sql = postgres(databaseUrl);

async function runMigration() {
  console.log('Menjalankan migrasi untuk Email Channel...');
  try {
    // 1. Add email to provider_type
    try {
      await sql`ALTER TYPE provider_type ADD VALUE IF NOT EXISTS 'email'`;
      console.log('Enum provider_type berhasil diupdate dengan email.');
    } catch (e: any) {
      if (!e.message.includes('already exists')) {
        throw e;
      }
    }

    // 2. Create email_message_metadata table
    await sql`
      CREATE TABLE IF NOT EXISTS email_message_metadata (
          id BIGSERIAL PRIMARY KEY,
          message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          email_message_id VARCHAR(255),
          in_reply_to VARCHAR(255),
          email_references TEXT,
          from_address VARCHAR(255) NOT NULL,
          to_addresses TEXT[] NOT NULL,
          cc_addresses TEXT[],
          bcc_addresses TEXT[],
          subject VARCHAR(500),
          html_content TEXT,
          has_attachments BOOLEAN DEFAULT FALSE,
          email_date TIMESTAMP WITH TIME ZONE
      );
    `;
    console.log('Tabel email_message_metadata berhasil dibuat atau sudah ada.');

    // 3. Create indexes
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_email_meta_message_id ON email_message_metadata(message_id)`;
    console.log('Index-index tabel Email Metadata berhasil dibuat atau sudah ada.');

    console.log('Migrasi Email Channel sukses!');
  } catch (err) {
    console.error('Migrasi gagal:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();
