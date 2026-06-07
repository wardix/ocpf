import { sql } from './src/config/database';

async function migrate() {
  console.log('Running Export Jobs migration...');
  try {
    await sql`
      DO $$ BEGIN
        CREATE TYPE export_status AS ENUM ('queued', 'processing', 'completed', 'failed', 'expired');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    await sql`
      DO $$ BEGIN
        CREATE TYPE export_format AS ENUM ('csv', 'xlsx');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS export_jobs (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          export_type VARCHAR(50) NOT NULL,
          export_format export_format NOT NULL DEFAULT 'csv',
          filters JSONB DEFAULT '{}'::jsonb,
          status export_status DEFAULT 'queued',
          file_path VARCHAR(1024),
          file_size_bytes BIGINT,
          row_count INT,
          progress_percent INT DEFAULT 0,
          expires_at TIMESTAMP WITH TIME ZONE,
          created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    process.exit(0);
  }
}

migrate();
