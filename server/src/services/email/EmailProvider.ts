export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
  trace?: EmailTraceContext;
}

export interface EmailTraceContext {
  campaignId: string;
  recipientId: string;
  sendAttemptId: string;
  tenantId?: string;
}

export interface SendResult {
  messageId: string;
  provider: string;
}

export interface SendingLimits {
  max24HourSend: number | null;
  maxSendRate: number | null;
  sentLast24Hours: number | null;
}

export interface SenderVerification {
  identity: string;
  verified: boolean;
  status: string;
}

export interface BatchSendResult {
  results: Array<SendResult | { error: Error }>;
}

export interface EmailProvider {
  send(options: EmailOptions): Promise<SendResult>;
  sendBatch(options: EmailOptions[]): Promise<BatchSendResult>;
  getSendingLimits(): Promise<SendingLimits>;
  verifySender(identity: string): Promise<SenderVerification>;
  verifyConnection(): Promise<boolean>;
}

export abstract class BaseEmailProvider implements EmailProvider {
  abstract send(options: EmailOptions): Promise<SendResult>;
  abstract verifyConnection(): Promise<boolean>;
  async sendBatch(options: EmailOptions[]): Promise<BatchSendResult> {
    const results: BatchSendResult['results'] = [];
    for (const email of options) {
      try { results.push(await this.send(email)); }
      catch (error) { results.push({ error: error instanceof Error ? error : new Error(String(error)) }); }
    }
    return { results };
  }
  async getSendingLimits(): Promise<SendingLimits> {
    return { max24HourSend: null, maxSendRate: null, sentLast24Hours: null };
  }
  async verifySender(identity: string): Promise<SenderVerification> {
    return { identity, verified: await this.verifyConnection(), status: 'connection_verified' };
  }
}

// Custom error classes for SMTP error classification
export class PermanentBounceError extends Error {
  public code: string;
  public recipient: string;

  constructor(message: string, code: string, recipient: string) {
    super(message);
    this.name = 'PermanentBounceError';
    this.code = code;
    this.recipient = recipient;
  }
}

export class TemporaryBounceError extends Error {
  public code: string;
  public recipient: string;

  constructor(message: string, code: string, recipient: string) {
    super(message);
    this.name = 'TemporaryBounceError';
    this.code = code;
    this.recipient = recipient;
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class SuppressedRecipientError extends Error {
  constructor(message: string) { super(message); this.name = 'SuppressedRecipientError'; }
}

export type FailureClassification = 'RETRYABLE' | 'NON_RETRYABLE';
export function classifyProviderFailure(error: unknown): FailureClassification {
  return error instanceof TemporaryBounceError || error instanceof RateLimitError ? 'RETRYABLE' : 'NON_RETRYABLE';
}

// Classify SMTP response codes
export function classifySmtpError(responseCode: number | string, message: string, recipient: string): Error {
  const code = typeof responseCode === 'string' ? parseInt(responseCode) : responseCode;

  // 5xx = permanent failure
  if (code >= 550 && code <= 559) {
    // 550 = mailbox not found, 551 = user not local, 552 = exceeded storage,
    // 553 = mailbox name not allowed, 554 = transaction failed
    return new PermanentBounceError(message, String(code), recipient);
  }

  // 4xx = temporary failure
  if (code >= 400 && code < 500) {
    // 421 = service not available, 450 = mailbox unavailable, 451 = local error, 452 = insufficient storage
    return new TemporaryBounceError(message, String(code), recipient);
  }

  // Auth failures
  if (code === 535 || code === 530) {
    return new AuthenticationError(message);
  }

  // Rate limits (Gmail-specific patterns)
  if (message.toLowerCase().includes('rate limit') || message.toLowerCase().includes('too many') || code === 429) {
    return new RateLimitError(message);
  }

  // Default: treat as temporary so it gets retried
  return new TemporaryBounceError(message, String(code || 'unknown'), recipient);
}
