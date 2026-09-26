import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn({ schema: 'integration', name: 'outbox' }, {
    action_type: { type: 'varchar(64)', notNull: true, default: pgm.func("'start_whatsapp_flow'") },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn({ schema: 'integration', name: 'outbox' }, 'action_type');
}
