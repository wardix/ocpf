import { sql } from './src/config/database';

async function migrate() {
  console.log('Running Scheduled Messages migration...');
  try {
    await sql`
      DO $$ BEGIN
          CREATE TYPE scheduled_message_status AS ENUM ('pending', 'sent', 'cancelled', 'failed');
      EXCEPTION
          WHEN duplicate_object THEN null;
      END $$;
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS scheduled_messages (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
          content TEXT NOT NULL,
          media JSONB,
          scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
          status scheduled_message_status DEFAULT 'pending',
          sent_at TIMESTAMP WITH TIME ZONE,
          error_message TEXT,
          retry_count INT DEFAULT 0,
          created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending 
      ON scheduled_messages(scheduled_at) WHERE status = 'pending';
    `;

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    process.exit(0);
  }
}

migrate();
