import { MigrationBuilder } from 'node-pg-migrate';

/** Cross-channel identity, attribution and reliable action-delivery primitives. */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('CREATE SCHEMA IF NOT EXISTS integration');

  pgm.createTable({ schema: 'integration', name: 'whatsapp_integrations' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    sendora_user_id: { type: 'uuid', notNull: true, references: 'admin_users', onDelete: 'CASCADE' },
    senqo_user_id: { type: 'varchar(128)' },
    senqo_workspace_id: { type: 'varchar(128)' },
    status: { type: 'varchar(16)', notNull: true, default: pgm.func("'pending'"), check: "status IN ('pending','active','unlinked','error')" },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex({ schema: 'integration', name: 'whatsapp_integrations' }, 'sendora_user_id', { unique: true });
  pgm.createIndex({ schema: 'integration', name: 'whatsapp_integrations' }, ['senqo_workspace_id', 'status']);

  pgm.createTable({ schema: 'integration', name: 'contact_identities' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    sendora_user_id: { type: 'uuid', notNull: true, references: 'admin_users', onDelete: 'CASCADE' },
    sendora_contact_id: { type: 'uuid', notNull: true, references: 'contacts', onDelete: 'CASCADE' },
    senqo_workspace_id: { type: 'varchar(128)' },
    senqo_contact_id: { type: 'varchar(128)' },
    email_normalized: { type: 'varchar(320)' },
    phone_e164: { type: 'varchar(32)' },
    match_method: { type: 'varchar(24)', notNull: true, default: pgm.func("'manual'"), check: "match_method IN ('manual','verified','exact_email','exact_phone')" },
    match_confidence: { type: 'numeric(5,2)' },
    whatsapp_opt_in: { type: 'boolean', notNull: true, default: false },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex({ schema: 'integration', name: 'contact_identities' }, ['sendora_user_id', 'sendora_contact_id'], { unique: true });
  pgm.createIndex({ schema: 'integration', name: 'contact_identities' }, ['sendora_user_id', 'phone_e164']);
  pgm.createIndex({ schema: 'integration', name: 'contact_identities' }, ['senqo_workspace_id', 'senqo_contact_id']);

  pgm.createTable({ schema: 'integration', name: 'campaign_links' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    sendora_user_id: { type: 'uuid', notNull: true, references: 'admin_users', onDelete: 'CASCADE' },
    // Projects are a legacy Sendora extension and are not present in every
    // fresh typed-migration install; keep this cross-system reference loose.
    project_id: { type: 'uuid' },
    sendora_campaign_id: { type: 'uuid', references: 'campaigns', onDelete: 'CASCADE' },
    senqo_workspace_id: { type: 'varchar(128)' },
    senqo_campaign_id: { type: 'varchar(128)' },
    senqo_flow_id: { type: 'varchar(128)' },
    source: { type: 'varchar(24)', notNull: true, default: pgm.func("'sendora_email'"), check: "source IN ('sendora_email','senqo_native')" },
    status: { type: 'varchar(16)', notNull: true, default: pgm.func("'active'"), check: "status IN ('active','paused','unlinked')" },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex({ schema: 'integration', name: 'campaign_links' }, ['sendora_campaign_id', 'senqo_flow_id'], { unique: true });
  pgm.createIndex({ schema: 'integration', name: 'campaign_links' }, ['senqo_workspace_id', 'senqo_campaign_id']);

  pgm.createTable({ schema: 'integration', name: 'cross_channel_rules' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    sendora_user_id: { type: 'uuid', notNull: true, references: 'admin_users', onDelete: 'CASCADE' },
    project_id: { type: 'uuid' },
    sendora_campaign_id: { type: 'uuid', references: 'campaigns', onDelete: 'CASCADE' },
    trigger_type: { type: 'varchar(32)', notNull: true, check: "trigger_type IN ('email_opened','email_clicked','email_replied','email_delivered')" },
    action_type: { type: 'varchar(32)', notNull: true, check: "action_type IN ('start_whatsapp_flow','send_whatsapp_template','human_handoff')" },
    conditions: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    action: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    cooldown_seconds: { type: 'integer', notNull: true, default: 86400 },
    enabled: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex({ schema: 'integration', name: 'cross_channel_rules' }, ['sendora_user_id', 'enabled', 'trigger_type']);

  pgm.createTable({ schema: 'integration', name: 'cross_channel_events' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    sendora_user_id: { type: 'uuid', notNull: true, references: 'admin_users', onDelete: 'CASCADE' },
    source: { type: 'varchar(24)', notNull: true },
    source_event_id: { type: 'varchar(255)', notNull: true },
    event_type: { type: 'varchar(32)', notNull: true },
    sendora_campaign_id: { type: 'uuid', references: 'campaigns', onDelete: 'SET NULL' },
    sendora_recipient_id: { type: 'uuid', references: 'campaign_recipients', onDelete: 'SET NULL' },
    senqo_workspace_id: { type: 'varchar(128)' },
    senqo_contact_id: { type: 'varchar(128)' },
    payload: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    processed_at: { type: 'timestamptz' },
  });
  pgm.createIndex({ schema: 'integration', name: 'cross_channel_events' }, ['source', 'source_event_id'], { unique: true });
  pgm.createIndex({ schema: 'integration', name: 'cross_channel_events' }, ['sendora_campaign_id', 'event_type', 'occurred_at']);

  pgm.createTable({ schema: 'integration', name: 'outbox' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    // Loose UUID reference avoids node-pg-migrate quoting a dotted table name;
    // the outbox is reconciled transactionally by the integration worker.
    event_id: { type: 'uuid', notNull: true },
    action_key: { type: 'varchar(255)', notNull: true, unique: true },
    destination: { type: 'varchar(32)', notNull: true, default: pgm.func("'senqo'"), check: "destination IN ('senqo')" },
    payload: { type: 'jsonb', notNull: true },
    status: { type: 'varchar(16)', notNull: true, default: pgm.func("'pending'"), check: "status IN ('pending','processing','sent','failed','dead_letter')" },
    attempts: { type: 'integer', notNull: true, default: 0 },
    next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    last_error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    processed_at: { type: 'timestamptz' },
  });
  pgm.createIndex({ schema: 'integration', name: 'outbox' }, ['status', 'next_attempt_at']);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable({ schema: 'integration', name: 'outbox' });
  pgm.dropTable({ schema: 'integration', name: 'cross_channel_events' });
  pgm.dropTable({ schema: 'integration', name: 'cross_channel_rules' });
  pgm.dropTable({ schema: 'integration', name: 'campaign_links' });
  pgm.dropTable({ schema: 'integration', name: 'contact_identities' });
  pgm.dropTable({ schema: 'integration', name: 'whatsapp_integrations' });
}
