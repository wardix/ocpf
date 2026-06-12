import { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('messages', {
    reply_to_message_id: {
      type: 'bigint',
      references: 'messages(id)',
      onDelete: 'SET NULL',
      notNull: false,
    },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn('messages', 'reply_to_message_id');
}
