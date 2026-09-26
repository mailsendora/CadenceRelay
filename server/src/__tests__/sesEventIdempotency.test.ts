const query = jest.fn();
const release = jest.fn();
jest.mock('../config/database', () => ({ pool: { connect: jest.fn(async () => ({ query, release })) } }));

import { processSesEvent } from '../services/email/sesEventProcessor';

it('stops recipient and counter mutations when the provider event already exists', async () => {
  query
    .mockResolvedValueOnce({}) // BEGIN
    .mockResolvedValueOnce({ rows: [{ id: 'recipient-1', campaign_id: 'campaign-1', email: 'person@example.com', status: 'sent' }] })
    .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // idempotency insert conflict
    .mockResolvedValueOnce({}); // ROLLBACK

  const result = await processSesEvent({
    id: 'duplicate-event', detail: { eventType: 'Delivery', mail: {
      messageId: 'message-1', timestamp: '2026-01-02T03:04:05Z', destination: ['person@example.com'],
      tags: { recipient_id: ['recipient-1'] },
    } },
  });

  expect(result).toBe('duplicate');
  expect(query).toHaveBeenCalledTimes(4);
  expect(release).toHaveBeenCalled();
});
