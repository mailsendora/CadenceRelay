export interface RatePolicy {
  minimumRate: number;
  maximumRate: number;
  increaseFactor: number;
  decreaseFactor: number;
  severeDecreaseFactor: number;
  minimumSampleSize: number;
  bouncePauseRate: number;
  complaintPauseRate: number;
  throttleDecreaseRate: number;
  delayDecreaseRate: number;
  transientFailureDecreaseRate: number;
}

export interface DeliveryHealth {
  attempted: number;
  bounced: number;
  complained: number;
  throttled: number;
  delayed: number;
  transientFailures: number;
}

export interface RateDecision { rate: number; pause: boolean; reason?: string; }

export function calculateAdaptiveRate(currentRate: number, health: DeliveryHealth, policy: RatePolicy, providerMaximum?: number | null): RateDecision {
  const ceiling = Math.max(policy.minimumRate, Math.min(policy.maximumRate, providerMaximum ?? policy.maximumRate));
  const attempted = Math.max(health.attempted, 1);
  const bounceRate = health.bounced / attempted;
  const complaintRate = health.complained / attempted;
  if (health.attempted >= policy.minimumSampleSize && complaintRate >= policy.complaintPauseRate) {
    return { rate: policy.minimumRate, pause: true, reason: `Complaint rate ${complaintRate.toFixed(4)} exceeded threshold` };
  }
  if (health.attempted >= policy.minimumSampleSize && bounceRate >= policy.bouncePauseRate) {
    return { rate: policy.minimumRate, pause: true, reason: `Bounce rate ${bounceRate.toFixed(4)} exceeded threshold` };
  }
  const unhealthy = health.throttled / attempted >= policy.throttleDecreaseRate ||
    health.delayed / attempted >= policy.delayDecreaseRate ||
    health.transientFailures / attempted >= policy.transientFailureDecreaseRate;
  const factor = unhealthy ? policy.decreaseFactor : policy.increaseFactor;
  return { rate: Math.max(policy.minimumRate, Math.min(ceiling, Number((currentRate * factor).toFixed(2)))), pause: false };
}

export function exponentialBackoffWithJitter(attempt: number, baseMs: number, maximumMs: number, random = Math.random): number {
  const cap = Math.min(maximumMs, baseMs * (2 ** Math.max(0, attempt - 1)));
  return Math.floor(random() * cap);
}
