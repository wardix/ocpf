import { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  // 1. Drop any legacy trigger/function/column/index on messages if they exist
  pgm.sql(`
    DROP TRIGGER IF EXISTS trig_messages_search_update ON messages;
    DROP FUNCTION IF EXISTS messages_search_trigger();
    DROP INDEX IF EXISTS idx_messages_search_vector;
    DROP INDEX IF EXISTS messages_search_idx;
    ALTER TABLE messages DROP COLUMN IF EXISTS search_vector;
  `);

  // 2. Add search_vector as a generated column to messages
  pgm.sql(`
    ALTER TABLE messages 
    ADD COLUMN search_vector tsvector 
    GENERATED ALWAYS AS (to_tsvector('indonesian', coalesce(content, ''))) STORED;
  `);

  // Create GIN index for messages search_vector
  pgm.createIndex('messages', 'search_vector', {
    name: 'messages_search_idx',
    method: 'gin',
  });

  // 3. Drop any existing column/index on contacts if they exist
  pgm.sql(`
    DROP INDEX IF EXISTS contacts_search_idx;
    ALTER TABLE contacts DROP COLUMN IF EXISTS search_vector;
  `);

  // 4. Add search_vector as a generated column to contacts
  pgm.sql(`
    ALTER TABLE contacts 
    ADD COLUMN search_vector tsvector 
    GENERATED ALWAYS AS (
      to_tsvector('simple', coalesce(name, '')) ||
      to_tsvector('simple', coalesce(phone_number, '')) ||
      to_tsvector('simple', coalesce(email, ''))
    ) STORED;
  `);

  // Create GIN index for contacts search_vector
  pgm.createIndex('contacts', 'search_vector', {
    name: 'contacts_search_idx',
    method: 'gin',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP INDEX IF EXISTS messages_search_idx;
    ALTER TABLE messages DROP COLUMN IF EXISTS search_vector;

    DROP INDEX IF EXISTS contacts_search_idx;
    ALTER TABLE contacts DROP COLUMN IF EXISTS search_vector;
  `);
}
