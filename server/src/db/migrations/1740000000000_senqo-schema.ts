import { MigrationBuilder } from 'node-pg-migrate';

/** Reserve an isolated namespace for Senqo tables in the shared Sendora DB. */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('CREATE SCHEMA IF NOT EXISTS senqo');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Senqo owns the tables in this schema. Never cascade-drop them from a
  // Sendora rollback; removing the schema is an explicit operator action.
  pgm.sql('DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = \'senqo\') THEN DROP SCHEMA IF EXISTS senqo; END IF; END $$;');
}

