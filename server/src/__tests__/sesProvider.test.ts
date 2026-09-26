import { SESProvider } from '../services/email/SESProvider';
import { RateLimitError } from '../services/email/EmailProvider';

describe('SESProvider', () => {
  const config = { region: 'us-east-1', fromEmail: 'sender@example.com', configurationSetName: 'campaign-events' };

  it('sends raw MIME with configuration set and trace tags', async () => {
    const send = jest.fn().mockResolvedValue({ MessageId: 'ses-123' });
    const provider = new SESProvider(config, { send } as never);
    const result = await provider.send({
      to: 'person@example.com', subject: 'Hello', html: '<p>Hello</p>', text: 'Hello',
      trace: { campaignId: 'campaign-1', recipientId: 'recipient-1', sendAttemptId: 'attempt-1' },
    });
    expect(result).toEqual({ messageId: 'ses-123', provider: 'ses' });
    const input = send.mock.calls[0][0].input;
    expect(input.ConfigurationSetName).toBe('campaign-events');
    expect(input.EmailTags).toEqual(expect.arrayContaining([{ Name: 'campaign_id', Value: 'campaign-1' }, { Name: 'send_attempt_id', Value: 'attempt-1' }]));
    expect(input.Content.Raw.Data).toBeInstanceOf(Uint8Array);
  });

  it('returns SES account limits', async () => {
    const send = jest.fn().mockResolvedValue({ SendQuota: { Max24HourSend: 1000, MaxSendRate: 20, SentLast24Hours: 25 } });
    const provider = new SESProvider(config, { send } as never);
    await expect(provider.getSendingLimits()).resolves.toEqual({ max24HourSend: 1000, maxSendRate: 20, sentLast24Hours: 25 });
  });

  it('classifies throttling as retryable rate limiting', async () => {
    const send = jest.fn().mockRejectedValue(Object.assign(new Error('slow down'), { name: 'TooManyRequestsException' }));
    const provider = new SESProvider(config, { send } as never);
    await expect(provider.send({ to: 'person@example.com', subject: 'x', html: 'x' })).rejects.toBeInstanceOf(RateLimitError);
  });
});
