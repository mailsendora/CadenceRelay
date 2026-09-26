import { parseSesEvent } from '../services/email/sesEventParser';

const event = (eventType: string, extra: Record<string, unknown> = {}) => ({
  id: `event-${eventType}`, detail: { eventType, mail: {
    messageId: 'message-1', timestamp: '2026-01-02T03:04:05Z', destination: ['recipient@example.com'],
    tags: { campaign_id: ['campaign-1'], recipient_id: ['recipient-1'], send_attempt_id: ['attempt-1'] },
  }, ...extra },
});

describe.each([
  ['Send', 'send'], ['Delivery', 'delivery'], ['Bounce', 'bounce'], ['Complaint', 'complaint'],
  ['Reject', 'reject'], ['DeliveryDelay', 'delivery_delay'], ['Open', 'open'], ['Click', 'click'],
])('SES event parser', (incoming, normalized) => {
  it(`normalizes ${incoming}`, () => {
    expect(parseSesEvent(event(incoming)).type).toBe(normalized);
  });
});

it('extracts trace tags and uses the EventBridge id for idempotency', () => {
  expect(parseSesEvent(event('Delivery'))).toMatchObject({
    eventId: 'event-Delivery', campaignId: 'campaign-1', recipientId: 'recipient-1', sendAttemptId: 'attempt-1', messageId: 'message-1',
  });
});

it('produces the same fingerprint for duplicate SNS events without an envelope id', () => {
  const sns = event('Delivery');
  delete (sns as { id?: string }).id;
  expect(parseSesEvent(sns).eventId).toBe(parseSesEvent(sns).eventId);
});

it('accepts modern EventBridge detail types', () => {
  const modern = event('ignored') as Record<string, unknown>;
  modern['detail-type'] = 'Email Delivered';
  delete (modern.detail as Record<string, unknown>).eventType;
  expect(parseSesEvent(modern).type).toBe('delivery');
});
