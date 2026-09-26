import { classifyProviderFailure, PermanentBounceError, RateLimitError, TemporaryBounceError } from '../services/email/EmailProvider';
import { calculateAdaptiveRate, exponentialBackoffWithJitter, RatePolicy } from '../services/sending/adaptiveRateController';
import { analyzeEmailQuality } from '../services/emailQuality/emailQualityService';
import { campaignRates } from '../services/analytics/campaignMetrics';
import { normalizeEmailAddress, shouldSuppressBounce } from '../services/email/suppressionPolicy';

const policy: RatePolicy = {
  minimumRate: 1, maximumRate: 100, increaseFactor: 1.1, decreaseFactor: 0.5, severeDecreaseFactor: 0.25,
  minimumSampleSize: 100, bouncePauseRate: 0.05, complaintPauseRate: 0.001,
  throttleDecreaseRate: 0.01, delayDecreaseRate: 0.05, transientFailureDecreaseRate: 0.02,
};

it('classifies retryable and permanent failures', () => {
  expect(classifyProviderFailure(new RateLimitError('x'))).toBe('RETRYABLE');
  expect(classifyProviderFailure(new TemporaryBounceError('x', '421', 'a@b.co'))).toBe('RETRYABLE');
  expect(classifyProviderFailure(new PermanentBounceError('x', '550', 'a@b.co'))).toBe('NON_RETRYABLE');
});

it('ramps healthy traffic without exceeding provider quota', () => {
  expect(calculateAdaptiveRate(10, { attempted: 100, bounced: 0, complained: 0, throttled: 0, delayed: 0, transientFailures: 0 }, policy, 10.5)).toEqual({ rate: 10.5, pause: false });
});

it('backs off on throttling and pauses on severe complaint rate', () => {
  expect(calculateAdaptiveRate(20, { attempted: 100, bounced: 0, complained: 0, throttled: 2, delayed: 0, transientFailures: 0 }, policy).rate).toBe(10);
  expect(calculateAdaptiveRate(20, { attempted: 1000, bounced: 0, complained: 2, throttled: 0, delayed: 0, transientFailures: 0 }, policy).pause).toBe(true);
});

it('uses bounded full jitter', () => {
  expect(exponentialBackoffWithJitter(3, 1000, 10000, () => 0.5)).toBe(2000);
});

it('returns an honest quality report', () => {
  const report = analyzeEmailQuality({ subject: 'News', from: 'sender@example.com', html: '<html><img src="x"><a href="javascript:x">Read</a></html>' });
  expect(report.errors.map(x => x.code)).toContain('unsubscribe_missing');
  expect(report.warnings.map(x => x.code)).toEqual(expect.arrayContaining(['text_missing', 'invalid_links', 'image_alt_missing']));
  expect(report.disclaimer).toContain('not a prediction');
});

it('aggregates campaign rates with distinct recipient counts', () => {
  expect(campaignRates({ sent: 100, delivered: 90, bounced: 5, complained: 1, opened: 45, clicked: 9 })).toEqual({
    deliveryRate: 90, bounceRate: 5, complaintRate: 1, openRate: 50, clickRate: 10, ctr: 9, ctor: 20,
  });
});

it('suppresses normalized addresses only for permanent bounces', () => {
  expect(normalizeEmailAddress(' Person@Example.COM ')).toBe('person@example.com');
  expect(shouldSuppressBounce('Permanent')).toBe(true);
  expect(shouldSuppressBounce('Transient')).toBe(false);
});
