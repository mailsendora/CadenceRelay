import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns('contacts', {
    timezone: { type: 'varchar(64)' },
    preference_token_version: { type: 'integer', notNull: true, default: 1 },
  });
  pgm.createTable('contact_preferences', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    contact_id: { type: 'uuid', notNull: true, references: 'contacts', onDelete: 'CASCADE' },
    topic: { type: 'varchar(100)', notNull: true, default: 'marketing' },
    status: { type: 'varchar(16)', notNull: true, default: 'subscribed', check: "status IN ('subscribed','unsubscribed')" },
    source: { type: 'varchar(32)', notNull: true, default: 'preference_center' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.addConstraint('contact_preferences', 'contact_preferences_contact_topic_unique', { unique: ['contact_id', 'topic'] });
  pgm.createIndex('contact_preferences', ['topic', 'status']);

  pgm.addColumns('campaigns', {
    approval_status: { type: 'varchar(20)', notNull: true, default: 'not_required' },
    approval_requested_by: { type: 'uuid', references: 'admin_users', onDelete: 'SET NULL' },
    approval_requested_at: { type: 'timestamptz' },
    approved_by: { type: 'uuid', references: 'admin_users', onDelete: 'SET NULL' },
    approved_at: { type: 'timestamptz' },
    approval_note: { type: 'text' },
    topic: { type: 'varchar(100)', notNull: true, default: 'marketing' },
    frequency_daily_limit: { type: 'integer', notNull: true, default: 2 },
    frequency_weekly_limit: { type: 'integer', notNull: true, default: 5 },
    minimum_gap_hours: { type: 'integer', notNull: true, default: 12 },
    duplicate_window_days: { type: 'integer', notNull: true, default: 14 },
    quiet_hours_start: { type: 'smallint', notNull: true, default: 21 },
    quiet_hours_end: { type: 'smallint', notNull: true, default: 8 },
    content_fingerprint: { type: 'varchar(64)' },
  });
  pgm.addConstraint('campaigns', 'campaigns_approval_status_check', { check: "approval_status IN ('not_required','pending','approved','rejected')" });
  pgm.addConstraint('campaigns', 'campaigns_frequency_positive', { check: 'frequency_daily_limit >= 0 AND frequency_weekly_limit >= 0 AND minimum_gap_hours >= 0 AND duplicate_window_days >= 0' });
  pgm.addConstraint('campaigns', 'campaigns_quiet_hours_valid', { check: 'quiet_hours_start BETWEEN 0 AND 23 AND quiet_hours_end BETWEEN 0 AND 23' });
  pgm.createIndex('campaigns', ['approval_status', 'created_at']);
  pgm.createIndex('campaigns', 'content_fingerprint');
  pgm.createIndex('campaign_recipients', ['contact_id', 'sent_at']);
  pgm.createIndex('campaign_recipients', ['email', 'sent_at']);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('campaign_recipients', ['email', 'sent_at']);
  pgm.dropIndex('campaign_recipients', ['contact_id', 'sent_at']);
  pgm.dropColumns('campaigns', ['approval_status','approval_requested_by','approval_requested_at','approved_by','approved_at','approval_note','topic','frequency_daily_limit','frequency_weekly_limit','minimum_gap_hours','duplicate_window_days','quiet_hours_start','quiet_hours_end','content_fingerprint']);
  pgm.dropTable('contact_preferences');
  pgm.dropColumns('contacts', ['timezone', 'preference_token_version']);
}
