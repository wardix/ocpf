import { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('whatsapp_auth_states', {
    id: 'bigserial primary key',
    inbox_id: {
      type: 'bigint',
      references: 'inboxes(id)',
      onDelete: 'CASCADE',
      notNull: true,
    },
    key: {
      type: 'varchar(255)',
      notNull: true,
    },
    value: {
      type: 'jsonb',
      notNull: true,
    },
  });

  pgm.addConstraint('whatsapp_auth_states', 'uq_whatsapp_auth_states_inbox_key', {
    unique: ['inbox_id', 'key'],
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('whatsapp_auth_states');
}
