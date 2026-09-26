import { createHash } from 'crypto';

export type SesEventType = 'send' | 'delivery' | 'bounce' | 'complaint' | 'reject' |
  'delivery_delay' | 'rendering_failure' | 'open' | 'click' | 'subscription';

export interface NormalizedSesEvent {
  eventId: string;
  type: SesEventType;
  messageId: string;
  timestamp: Date;
  destinations: string[];
  campaignId?: string;
  recipientId?: string;
  sendAttemptId?: string;
  tenantId?: string;
  metadata: Record<string, unknown>;
}

const TYPES: Record<string, SesEventType> = {
  send: 'send', sendingevent: 'send', delivery: 'delivery', delivered: 'delivery', bounce: 'bounce', bounced: 'bounce',
  complaint: 'complaint', reject: 'reject', rejected: 'reject',
  deliverydelay: 'delivery_delay', deliverydelayed: 'delivery_delay', renderingfailure: 'rendering_failure', renderingfailed: 'rendering_failure', open: 'open', click: 'click',
  opened: 'open', clicked: 'click', subscription: 'subscription', subscriptionevent: 'subscription', subscriptionclick: 'subscription',
};

function firstTag(tags: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = tags?.[name];
  return Array.isArray(value) ? String(value[0] || '') || undefined : typeof value === 'string' ? value : undefined;
}

export function parseSesEvent(input: Record<string, unknown>, envelopeId?: string): NormalizedSesEvent {
  const detail = (input.detail && typeof input.detail === 'object' ? input.detail : input) as Record<string, unknown>;
  const mail = detail.mail as Record<string, unknown> | undefined;
  if (!mail || typeof mail.messageId !== 'string') throw new Error('SES event missing mail.messageId');

  const rawType = String(detail.eventType || detail.notificationType || input['detail-type'] || '')
    .replace(/^Email\s+/i, '').replace(/\s+Received$/i, '').replace(/[^a-z]/gi, '').toLowerCase();
  const type = TYPES[rawType];
  if (!type) throw new Error(`Unsupported SES event type: ${rawType || 'unknown'}`);

  const destinations = Array.isArray(mail.destination) ? mail.destination.map(String) : [];
  const tags = mail.tags as Record<string, unknown> | undefined;
  const timestampText = String(mail.timestamp || detail.timestamp || input.time || new Date().toISOString());
  const timestamp = new Date(timestampText);
  if (Number.isNaN(timestamp.getTime())) throw new Error('SES event has invalid timestamp');
  const stableMaterial = JSON.stringify([mail.messageId, type, timestamp.toISOString(), destinations, detail[type] || detail]);
  const eventId = envelopeId || (typeof input.id === 'string' ? input.id : createHash('sha256').update(stableMaterial).digest('hex'));

  return {
    eventId, type, messageId: mail.messageId, timestamp, destinations,
    campaignId: firstTag(tags, 'campaign_id') || firstTag(tags, 'campaignId'),
    recipientId: firstTag(tags, 'recipient_id') || firstTag(tags, 'recipientId'),
    sendAttemptId: firstTag(tags, 'send_attempt_id') || firstTag(tags, 'sendAttemptId'),
    tenantId: firstTag(tags, 'tenant_id') || firstTag(tags, 'tenantId'),
    metadata: detail,
  };
}
