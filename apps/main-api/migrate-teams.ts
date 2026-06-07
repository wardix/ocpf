import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/omnichannel';
const sql = postgres(DATABASE_URL);

async function migrate() {
  console.log('Starting migration for Teams/Departments...');
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS teams (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (account_id, name)
      );
    `;
    console.log('Created teams table.');

    await sql`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_member_role') THEN
              CREATE TYPE team_member_role AS ENUM ('member', 'leader');
          END IF;
      END$$;
    `;
    
    await sql`
      CREATE TABLE IF NOT EXISTS team_members (
          id BIGSERIAL PRIMARY KEY,
          team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role team_member_role DEFAULT 'member',
          UNIQUE (team_id, user_id)
      );
    `;
    console.log('Created team_members table.');

    await sql`
      CREATE TABLE IF NOT EXISTS label_team_routing (
          id BIGSERIAL PRIMARY KEY,
          account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          label_id BIGINT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
          team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          UNIQUE (label_id, team_id)
      );
    `;
    console.log('Created label_team_routing table.');

    await sql`
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL;
    `;
    console.log('Added team_id column to tickets table.');

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sql.end();
  }
}

migrate();
