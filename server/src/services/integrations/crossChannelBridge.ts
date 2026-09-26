import { pool } from '../../config/database';
import { logger } from '../../utils/logger';

type BridgeEvent = {
  sourceEventId: string;
  eventType: 'email_opened' | 'email_clicked' | 'email_replied' | 'email_delivered';
  campaignId: string;
  recipientId: string;
  email: string;
  phone?: string | null;
  payload?: Record<string, unknown>;
};

/** Records an email signal once and materialises matching WhatsApp actions in the outbox. */
export async function publishCrossChannelEvent(event: BridgeEvent): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owner = await client.query(
      `SELECT COALESCE(cl.sendora_user_id, wi.sendora_user_id) AS sendora_user_id,
              wi.senqo_workspace_id
         FROM integration.whatsapp_integrations wi
         LEFT JOIN integration.campaign_links cl
           ON cl.sendora_campaign_id = $1 AND cl.sendora_user_id = wi.sendora_user_id
        WHERE wi.status = 'active'
        ORDER BY (cl.id IS NOT NULL) DESC, wi.created_at LIMIT 1`,
      [event.campaignId],
    );
    if (!owner.rowCount) {
      await client.query('ROLLBACK');
      return;
    }
    const sendoraUserId = owner.rows[0].sendora_user_id as string;
    const senqoWorkspaceId = owner.rows[0].senqo_workspace_id as string | null;
    const inserted = await client.query(
      `INSERT INTO integration.cross_channel_events
        (sendora_user_id, source, source_event_id, event_type, sendora_campaign_id, sendora_recipient_id, payload)
       VALUES ($1, 'sendora_email', $2, $3, $4, $5, $6)
       ON CONFLICT (source, source_event_id) DO NOTHING RETURNING id`,
      [sendoraUserId, event.sourceEventId, event.eventType, event.campaignId, event.recipientId, JSON.stringify({ ...event.payload, email: event.email, phone: event.phone ?? null })],
    );
    if (!inserted.rowCount) {
      await client.query('ROLLBACK');
      return;
    }

    const rules = await client.query(
      `SELECT id, action_type, action_config, conditions
        FROM integration.cross_channel_rules
        WHERE enabled = TRUE AND sendora_user_id = $3 AND trigger_type = $1
          AND (campaign_id IS NULL OR campaign_id = $2)`,
      [event.eventType, event.campaignId, sendoraUserId],
    );
    for (const rule of rules.rows) {
      const actionKey = `${inserted.rows[0].id}:${rule.id}`;
      await client.query(
        `INSERT INTO integration.outbox
          (event_id, action_key, destination, action_type, payload)
         VALUES ($1, $2, 'senqo', $3, $4)
         ON CONFLICT (action_key) DO NOTHING`,
        [inserted.rows[0].id, actionKey, rule.action_type, JSON.stringify({
          ...event.payload,
          email: event.email,
          sendoraCampaignId: event.campaignId,
          sendoraRecipientId: event.recipientId,
          ruleId: rule.id,
          actionConfig: rule.action,
          senqoWorkspaceId,
        })],
      );
    }
    await client.query('COMMIT');
    logger.info('cross-channel email signal recorded', {
      campaign_id: event.campaignId,
      recipient_id: event.recipientId,
      event_type: event.eventType,
      matched_rules: rules.rowCount,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('cross-channel bridge failed', { event_type: event.eventType, error: String(error) });
  } finally {
    client.release();
  }
}
