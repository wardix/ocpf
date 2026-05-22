import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/omnichannel');

async function runMigration() {
  console.log('Mulai membuat indeks database untuk performa messages...');

  try {
    await sql`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    `;
    console.log('Berhasil: Index pada messages.conversation_id');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_messages_ticket_id ON messages(ticket_id);
    `;
    console.log('Berhasil: Index pada messages.ticket_id');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    `;
    console.log('Berhasil: Index pada messages.created_at');

    console.log('Migrasi indeks selesai.');
  } catch (error) {
    console.error('Gagal menjalankan migrasi indeks:', error);
  } finally {
    process.exit(0);
  }
}

runMigration();