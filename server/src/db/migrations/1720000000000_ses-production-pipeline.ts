import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE campaign_recipients DROP CONSTRAINT IF EXISTS campaign_recipients_status_check;
    ALTER TABLE campaign_recipients ADD CONSTRAINT campaign_recipients_status_check CHECK (
      status IN ('pending','queued','sending','sent','delivered','delivery_delayed','bounced','failed',
                 'rejected','suppressed','opened','clicked','complained','unsubscribed')
    );
  `);

  pgm.createTable('email_send_attempts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    campaign_id: { type: 'uuid', notNull: true, references: 'campaigns', onDelete: 'CASCADE' },
    campaign_recipient_id: { type: 'uuid', notNull: true, references: 'campaign_recipients', onDelete: 'CASCADE' },
    attempt_number: { type: 'integer', notNull: true },
    provider: { type: 'varchar(32)', notNull: true },
    provider_message_id: { type: 'varchar(255)' },
    status: { type: 'varchar(24)', notNull: true, default: 'started' },
    failure_classification: { type: 'varchar(20)' },
    error_code: { type: 'varchar(120)' },
    error_message: { type: 'text' },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    completed_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('email_send_attempts', 'email_send_attempts_recipient_number_unique', { unique: ['campaign_recipient_id', 'attempt_number'] });
  pgm.createIndex('email_send_attempts', ['campaign_id', 'started_at']);
  pgm.createIndex('email_send_attempts', 'campaign_recipient_id');
  pgm.createIndex('email_send_attempts', 'provider_message_id');

  pgm.sql(`
    ALTER TABLE email_events DROP CONSTRAINT IF EXISTS email_events_event_type_check;
    ALTER TABLE email_events ADD CONSTRAINT email_events_event_type_check CHECK (
      event_type IN ('queued','sending','send','sent','delivery','delivered','delivery_delay','bounced',
                     'complained','rejected','rendering_failure','opened','clicked','subscription',
                     'unsubscribed','suppressed','failed')
    );
  `);
  pgm.addColumns('email_events', {
    event_id: { type: 'varchar(128)' },
    provider: { type: 'varchar(32)', notNull: true, default: 'application' },
    provider_message_id: { type: 'varchar(255)' },
    send_attempt_id: { type: 'uuid', references: 'email_send_attempts', onDelete: 'SET NULL' },
    event_timestamp: { type: 'timestamptz' },
    source: { type: 'varchar(32)', notNull: true, default: 'application' },
  });
  pgm.createIndex('email_events', ['provider', 'event_id'], { unique: true, where: 'event_id IS NOT NULL' });
  pgm.createIndex('email_events', 'provider_message_id');
  pgm.createIndex('email_events', ['campaign_id', 'event_type', 'created_at']);

  pgm.addColumns('suppression_list', {
    source: { type: 'varchar(32)', notNull: true, default: 'application' },
    provider: { type: 'varchar(32)' },
    provider_metadata: { type: 'jsonb', notNull: true, default: '{}' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('suppression_list', 'created_at');

  pgm.addColumns('campaigns', {
    attempted_count: { type: 'integer', notNull: true, default: 0 },
    delivered_count: { type: 'integer', notNull: true, default: 0 },
    delivery_delayed_count: { type: 'integer', notNull: true, default: 0 },
    rejected_count: { type: 'integer', notNull: true, default: 0 },
    suppressed_count: { type: 'integer', notNull: true, default: 0 },
    current_send_rate: { type: 'numeric(10,2)' },
    rate_controller_state: { type: 'jsonb', notNull: true, default: '{}' },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumns('campaigns', ['attempted_count', 'delivered_count', 'delivery_delayed_count', 'rejected_count', 'suppressed_count', 'current_send_rate', 'rate_controller_state']);
  pgm.dropColumns('suppression_list', ['source', 'provider', 'provider_metadata', 'updated_at']);
  pgm.dropIndex('email_events', ['campaign_id', 'event_type', 'created_at']);
  pgm.dropIndex('email_events', 'provider_message_id');
  pgm.dropIndex('email_events', ['provider', 'event_id']);
  pgm.dropColumns('email_events', ['event_id', 'provider', 'provider_message_id', 'send_attempt_id', 'event_timestamp', 'source']);
  pgm.dropTable('email_send_attempts');
}
