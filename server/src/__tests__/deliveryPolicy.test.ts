import { deliveryBlockReason, isQuietHour, localHour, millisecondsUntilQuietHoursEnd, DeliveryPolicy } from '../services/sending/deliveryPolicy';
import { approvalAllowsSending, canDecideApproval } from '../services/campaign/approvalPolicy';

const policy: DeliveryPolicy = { quietHoursStart: 21, quietHoursEnd: 8, dailyLimit: 2, weeklyLimit: 5, minimumGapHours: 12, duplicateWindowDays: 14 };
const healthy = { sentToday: 0, sentThisWeek: 0, hoursSinceLastSend: null, duplicateRecentlySent: false, topicUnsubscribed: false };

describe('recipient delivery policy', () => {
  it('handles quiet hours that cross midnight', () => {
    expect(isQuietHour(22, 21, 8)).toBe(true);
    expect(isQuietHour(7, 21, 8)).toBe(true);
    expect(isQuietHour(12, 21, 8)).toBe(false);
  });

  it('uses recipient IANA timezone and calculates a bounded delay', () => {
    const now = new Date('2026-09-06T18:00:00Z'); // 23:30 Asia/Kolkata
    expect(localHour(now, 'Asia/Kolkata')).toBe(23);
    const delay = millisecondsUntilQuietHoursEnd(now, 'Asia/Kolkata', 21, 8);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(24 * 60 * 60_000);
  });

  it.each([
    [{ ...healthy, topicUnsubscribed: true }, 'topic_unsubscribed'],
    [{ ...healthy, sentToday: 2 }, 'daily_frequency_cap'],
    [{ ...healthy, sentThisWeek: 5 }, 'weekly_frequency_cap'],
    [{ ...healthy, hoursSinceLastSend: 3 }, 'minimum_gap'],
    [{ ...healthy, duplicateRecentlySent: true }, 'duplicate_content'],
  ])('blocks fatigue condition %#', (facts, reason) => {
    expect(deliveryBlockReason(facts, policy)).toBe(reason);
  });

  it('allows healthy recipients', () => expect(deliveryBlockReason(healthy, policy)).toBeNull());
});

describe('campaign approval safety', () => {
  expect(approvalAllowsSending('approved')).toBe(true);
  expect(approvalAllowsSending('pending')).toBe(false);
  expect(canDecideApproval('maker', 'maker', false)).toBe(false);
  expect(canDecideApproval('maker', 'checker', false)).toBe(true);
});
