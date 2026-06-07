import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/ocpf');

async function migrate() {
  try {
    console.log('Starting notifications migration...');
    
    // Check if ENUM exists before creating
    const enumCheck = await sql`
      SELECT 1 FROM pg_type WHERE typname = 'notification_type'
    `;
    
    if (enumCheck.length === 0) {
      await sql`
        CREATE TYPE notification_type AS ENUM (
          'conversation_assigned', 
          'mentioned_in_note', 
          'snoozed_ticket_due', 
          'broadcast_completed', 
          'new_conversation'
        );
      `;
      console.log('Created ENUM notification_type');
    }

    await sql`
      CREATE TABLE IF NOT EXISTS notifications (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        type notification_type NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT,
        data JSONB DEFAULT '{}'::jsonb,
        read_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    
    console.log('Created notifications table');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    `;

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sql.end();
  }
}

migrate();
