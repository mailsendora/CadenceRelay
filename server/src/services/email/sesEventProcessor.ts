import { PoolClient } from 'pg';
import { pool } from '../../config/database';
import { logger } from '../../utils/logger';
import { NormalizedSesEvent, parseSesEvent } from './sesEventParser';
import { shouldSuppressBounce } from './suppressionPolicy';
import { publishCrossChannelEvent } from '../integrations/crossChannelBridge';

const EVENT_NAMES: Record<NormalizedSesEvent['type'], string> = {
  send: 'send', delivery: 'delivered', bounce: 'bounced', complaint: 'complained',
  reject: 'rejected', delivery_delay: 'delivery_delay', rendering_failure: 'rendering_failure',
  open: 'opened', click: 'clicked', subscription: 'subscription',
};

export async function processSesEvent(input: Record<string, unknown>, envelopeId?: string): Promise<'processed' | 'duplicate' | 'unknown_recipient'> {
  const event = parseSesEvent(input, envelopeId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recipient = await findRecipient(client, event);
    if (!recipient) {
      await client.query('ROLLBACK');
      logger.warn('SES event has no matching recipient', { ses_message_id: event.messageId, event_type: event.type });
      return 'unknown_recipient';
    }

    const inserted = await client.query(
      `INSERT INTO email_events
        (campaign_recipient_id, campaign_id, event_type, event_id, provider, provider_message_id,
         send_attempt_id, event_timestamp, source, metadata)
       VALUES ($1,$2,$3,$4,'ses',$5,$6,$7,'ses',$8)
       ON CONFLICT (provider, event_id) WHERE event_id IS NOT NULL DO NOTHING RETURNING id`,
      [recipient.id, recipient.campaign_id, EVENT_NAMES[event.type], event.eventId, event.messageId,
       event.sendAttemptId || recipient.send_attempt_id || null, event.timestamp, JSON.stringify(event.metadata)]
    );
    if (inserted.rowCount === 0) {
      await client.query('ROLLBACK');
      return 'duplicate';
    }

    await applyRecipientEvent(client, recipient, event);
    await client.query('COMMIT');
    if (event.type === 'open' || event.type === 'click' || event.type === 'delivery') {
      void publishCrossChannelEvent({
        sourceEventId: event.eventId,
        eventType: event.type === 'open' ? 'email_opened' : event.type === 'click' ? 'email_clicked' : 'email_delivered',
        campaignId: recipient.campaign_id,
        recipientId: recipient.id,
        email: recipient.email,
        phone: recipient.phone,
        payload: event.metadata,
      });
    }
    logger.info('SES event processed', {
      campaign_id: recipient.campaign_id, recipient_id: recipient.id,
      send_attempt_id: event.sendAttemptId || recipient.send_attempt_id,
      ses_message_id: event.messageId, event_type: event.type,
    });
    return 'processed';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findRecipient(client: PoolClient, event: NormalizedSesEvent) {
  const result = event.recipientId
    ? await client.query(
        `SELECT cr.id, cr.campaign_id, cr.email, cr.status, c.phone, esa.id AS send_attempt_id
         FROM campaign_recipients cr LEFT JOIN contacts c ON c.id = cr.contact_id LEFT JOIN email_send_attempts esa ON esa.id = $2
         WHERE cr.id = $1`, [event.recipientId, event.sendAttemptId || null])
    : await client.query(
        `SELECT cr.id, cr.campaign_id, cr.email, cr.status, c.phone, esa.id AS send_attempt_id
         FROM campaign_recipients cr
         LEFT JOIN contacts c ON c.id = cr.contact_id
         LEFT JOIN email_send_attempts esa ON esa.provider_message_id = $1
         WHERE cr.provider_message_id = $1 OR esa.provider_message_id = $1
         ORDER BY esa.started_at DESC NULLS LAST LIMIT 1`, [event.messageId]);
  return result.rows[0];
}

async function applyRecipientEvent(client: PoolClient, recipient: Record<string, string>, event: NormalizedSesEvent): Promise<void> {
  const id = recipient.id;
  const campaignId = recipient.campaign_id;
  switch (event.type) {
    case 'send':
      await client.query("UPDATE campaign_recipients SET status = 'sent', sent_at = COALESCE(sent_at,$2), provider_message_id = $3 WHERE id = $1 AND status IN ('pending','queued','sending')", [id, event.timestamp, event.messageId]);
      break;
    case 'delivery': {
      const changed = await client.query("UPDATE campaign_recipients SET status = 'delivered', delivered_at = COALESCE(delivered_at,$2) WHERE id = $1 AND status NOT IN ('delivered','bounced','complained','rejected','unsubscribed') RETURNING id", [id, event.timestamp]);
      if (changed.rowCount) await client.query('UPDATE campaigns SET delivered_count = delivered_count + 1, updated_at = NOW() WHERE id = $1', [campaignId]);
      break;
    }
    case 'delivery_delay': {
      const changed = await client.query("UPDATE campaign_recipients SET status = 'delivery_delayed' WHERE id = $1 AND status IN ('sent','sending') RETURNING id", [id]);
      if (changed.rowCount) await client.query('UPDATE campaigns SET delivery_delayed_count = delivery_delayed_count + 1, updated_at = NOW() WHERE id = $1', [campaignId]);
      break;
    }
    case 'bounce': {
      const bounce = event.metadata.bounce as Record<string, unknown> | undefined;
      const permanent = shouldSuppressBounce(String(bounce?.bounceType || ''));
      const changed = await client.query("UPDATE campaign_recipients SET status = 'bounced', bounce_type = $2, bounced_at = COALESCE(bounced_at,$3), error_message = $4 WHERE id = $1 AND status != 'bounced' RETURNING id", [id, permanent ? 'permanent' : 'transient', event.timestamp, JSON.stringify(bounce || {})]);
      if (changed.rowCount) {
        await client.query('UPDATE campaigns SET bounce_count = bounce_count + 1, updated_at = NOW() WHERE id = $1', [campaignId]);
        if (permanent) await suppress(client, recipient.email, 'permanent_bounce', event);
      }
      break;
    }
    case 'complaint': {
      const changed = await client.query("UPDATE campaign_recipients SET status = 'complained' WHERE id = $1 AND status != 'complained' RETURNING id", [id]);
      if (changed.rowCount) {
        await client.query('UPDATE campaigns SET complaint_count = complaint_count + 1, updated_at = NOW() WHERE id = $1', [campaignId]);
        await suppress(client, recipient.email, 'complaint', event);
      }
      break;
    }
    case 'reject':
    case 'rendering_failure': {
      const changed = await client.query("UPDATE campaign_recipients SET status = 'rejected', error_message = $2 WHERE id = $1 AND status != 'rejected' RETURNING id", [id, JSON.stringify(event.metadata[event.type] || event.metadata)]);
      if (changed.rowCount) await client.query('UPDATE campaigns SET rejected_count = rejected_count + 1, updated_at = NOW() WHERE id = $1', [campaignId]);
      break;
    }
    case 'open': {
      const first = await client.query('UPDATE campaign_recipients SET opened_at = COALESCE(opened_at,$2), last_opened_at = $2, open_count = COALESCE(open_count,0)+1 WHERE id = $1 RETURNING (open_count = 1) AS first', [id, event.timestamp]);
      if (first.rows[0]?.first) await client.query('UPDATE campaigns SET open_count = open_count + 1, updated_at = NOW() WHERE id = $1', [campaignId]);
      break;
    }
    case 'click': {
      const first = await client.query('UPDATE campaign_recipients SET clicked_at = COALESCE(clicked_at,$2), last_clicked_at = $2, click_count = COALESCE(click_count,0)+1 WHERE id = $1 RETURNING (click_count = 1) AS first', [id, event.timestamp]);
      if (first.rows[0]?.first) await client.query('UPDATE campaigns SET click_count = click_count + 1, updated_at = NOW() WHERE id = $1', [campaignId]);
      break;
    }
    case 'subscription': {
      const subscription = event.metadata.subscription as Record<string, unknown> | undefined;
      const status = String(subscription?.newTopicPreferences || subscription?.status || '').toLowerCase();
      if (status.includes('opt_out') || status.includes('unsubscribe')) await suppress(client, recipient.email, 'unsubscribed', event);
      break;
    }
  }
}

async function suppress(client: PoolClient, email: string, reason: string, event: NormalizedSesEvent): Promise<void> {
  await client.query(
    `INSERT INTO suppression_list (email, reason, added_by, source, provider, provider_metadata)
     VALUES ($1,$2,'auto','ses','ses',$3)
     ON CONFLICT (LOWER(email)) DO UPDATE SET reason=EXCLUDED.reason, source='ses', provider='ses',
       provider_metadata=EXCLUDED.provider_metadata, updated_at=NOW()`,
    [email, reason, JSON.stringify({ eventId: event.eventId, messageId: event.messageId })]
  );
  const contactStatus = reason === 'complaint' ? 'complained' : reason === 'unsubscribed' ? 'unsubscribed' : 'bounced';
  await client.query('UPDATE contacts SET status = $2, updated_at = NOW() WHERE LOWER(email) = LOWER($1)', [email, contactStatus]);
}
