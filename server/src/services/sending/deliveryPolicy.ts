export interface DeliveryPolicy {
  quietHoursStart: number; quietHoursEnd: number;
  dailyLimit: number; weeklyLimit: number; minimumGapHours: number; duplicateWindowDays: number;
}

export function localHour(date: Date, timezone: string): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(date));
  } catch { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', hourCycle: 'h23' }).format(date)); }
}

export function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function millisecondsUntilQuietHoursEnd(date: Date, timezone: string, start: number, end: number): number {
  if (!isQuietHour(localHour(date, timezone), start, end)) return 0;
  for (let minutes = 1; minutes <= 24 * 60; minutes++) {
    const candidate = new Date(date.getTime() + minutes * 60_000);
    if (!isQuietHour(localHour(candidate, timezone), start, end)) return minutes * 60_000;
  }
  return 24 * 60 * 60_000;
}

export interface FatigueFacts { sentToday: number; sentThisWeek: number; hoursSinceLastSend: number | null; duplicateRecentlySent: boolean; topicUnsubscribed: boolean; }
export function deliveryBlockReason(facts: FatigueFacts, policy: DeliveryPolicy): string | null {
  if (facts.topicUnsubscribed) return 'topic_unsubscribed';
  if (policy.dailyLimit > 0 && facts.sentToday >= policy.dailyLimit) return 'daily_frequency_cap';
  if (policy.weeklyLimit > 0 && facts.sentThisWeek >= policy.weeklyLimit) return 'weekly_frequency_cap';
  if (policy.minimumGapHours > 0 && facts.hoursSinceLastSend !== null && facts.hoursSinceLastSend < policy.minimumGapHours) return 'minimum_gap';
  if (policy.duplicateWindowDays > 0 && facts.duplicateRecentlySent) return 'duplicate_content';
  return null;
}
