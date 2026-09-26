import { pool } from '../../config/database';
import { deliveryBlockReason, DeliveryPolicy, millisecondsUntilQuietHoursEnd } from './deliveryPolicy';

export interface EligibilityResult { allowed: boolean; reason?: string; delayMs?: number; timezone: string; }

export async function evaluateRecipientEligibility(campaignId: string, recipientId: string, now = new Date()): Promise<EligibilityResult> {
  const result = await pool.query(
    `SELECT cr.contact_id,cr.email,COALESCE(c.timezone,'UTC') timezone,
      cam.topic,cam.frequency_daily_limit,cam.frequency_weekly_limit,cam.minimum_gap_hours,
      cam.duplicate_window_days,cam.quiet_hours_start,cam.quiet_hours_end,cam.content_fingerprint,
      (SELECT COUNT(*) FROM campaign_recipients x WHERE x.id<>cr.id AND (x.contact_id=cr.contact_id OR LOWER(x.email)=LOWER(cr.email)) AND x.sent_at >= $3 - INTERVAL '24 hours') sent_today,
      (SELECT COUNT(*) FROM campaign_recipients x WHERE x.id<>cr.id AND (x.contact_id=cr.contact_id OR LOWER(x.email)=LOWER(cr.email)) AND x.sent_at >= $3 - INTERVAL '7 days') sent_week,
      (SELECT EXTRACT(EPOCH FROM ($3-MAX(x.sent_at)))/3600 FROM campaign_recipients x WHERE x.id<>cr.id AND (x.contact_id=cr.contact_id OR LOWER(x.email)=LOWER(cr.email)) AND x.sent_at IS NOT NULL) hours_since_last,
      EXISTS(SELECT 1 FROM campaign_recipients x JOIN campaigns old ON old.id=x.campaign_id WHERE x.id<>cr.id AND (x.contact_id=cr.contact_id OR LOWER(x.email)=LOWER(cr.email)) AND x.sent_at >= $3-(cam.duplicate_window_days*INTERVAL '1 day') AND old.content_fingerprint=cam.content_fingerprint) duplicate_sent,
      EXISTS(SELECT 1 FROM contact_preferences cp WHERE cp.contact_id=cr.contact_id AND cp.topic=cam.topic AND cp.status='unsubscribed') topic_unsubscribed
     FROM campaign_recipients cr JOIN campaigns cam ON cam.id=cr.campaign_id LEFT JOIN contacts c ON c.id=cr.contact_id
     WHERE cr.id=$1 AND cam.id=$2`, [recipientId, campaignId, now]);
  if (!result.rowCount) return { allowed: false, reason: 'recipient_not_found', timezone: 'UTC' };
  const row = result.rows[0];
  const policy: DeliveryPolicy = {
    quietHoursStart: Number(row.quiet_hours_start), quietHoursEnd: Number(row.quiet_hours_end),
    dailyLimit: Number(row.frequency_daily_limit), weeklyLimit: Number(row.frequency_weekly_limit),
    minimumGapHours: Number(row.minimum_gap_hours), duplicateWindowDays: Number(row.duplicate_window_days),
  };
  const delayMs = millisecondsUntilQuietHoursEnd(now, row.timezone, policy.quietHoursStart, policy.quietHoursEnd);
  if (delayMs > 0) return { allowed: false, reason: 'quiet_hours', delayMs, timezone: row.timezone };
  const reason = deliveryBlockReason({
    sentToday: Number(row.sent_today), sentThisWeek: Number(row.sent_week),
    hoursSinceLastSend: row.hours_since_last == null ? null : Number(row.hours_since_last),
    duplicateRecentlySent: row.duplicate_sent, topicUnsubscribed: row.topic_unsubscribed,
  }, policy);
  return reason ? { allowed: false, reason, timezone: row.timezone } : { allowed: true, timezone: row.timezone };
}
