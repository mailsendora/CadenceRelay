import { SESv2Client, SendEmailCommand, GetAccountCommand, GetEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import nodemailer from 'nodemailer';
import {
  BaseEmailProvider, EmailOptions, SendResult, SendingLimits, SenderVerification,
  PermanentBounceError, RateLimitError, AuthenticationError, TemporaryBounceError,
} from './EmailProvider';
import { logger } from '../../utils/logger';

interface SESConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  fromEmail: string;
  fromName?: string;
  configurationSetName?: string;
  endpoint?: string;
}

const tagValue = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);

export class SESProvider extends BaseEmailProvider {
  private readonly client: SESv2Client;
  private readonly fromEmail: string;
  private readonly fromAddress: string;
  private readonly configurationSetName?: string;
  private readonly transporter: nodemailer.Transporter;

  constructor(config: SESConfig, client?: SESv2Client) {
    super();
    this.fromEmail = config.fromEmail;
    this.fromAddress = config.fromName
      ? `"${config.fromName.replace(/["\r\n]/g, '')}" <${config.fromEmail}>`
      : config.fromEmail;
    this.configurationSetName = config.configurationSetName || undefined;
    const credentials = config.accessKeyId && config.secretAccessKey
      ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}) }
      : undefined;
    this.client = client || new SESv2Client({
      region: config.region,
      ...(credentials ? { credentials } : {}),
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
    this.transporter = nodemailer.createTransport({ streamTransport: true });
  }

  async send(options: EmailOptions): Promise<SendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: options.from || this.fromAddress, to: options.to, subject: options.subject,
        html: options.html, text: options.text, replyTo: options.replyTo,
        headers: options.headers || {}, attachments: options.attachments,
      });
      const rawMessage = await streamToBuffer(info.message);
      const trace = options.trace;
      const response = await this.client.send(new SendEmailCommand({
        FromEmailAddress: options.from || this.fromAddress,
        Destination: { ToAddresses: [options.to] },
        Content: { Raw: { Data: rawMessage } },
        ...(this.configurationSetName ? { ConfigurationSetName: this.configurationSetName } : {}),
        ...(trace ? { EmailTags: [
          { Name: 'campaign_id', Value: tagValue(trace.campaignId) },
          { Name: 'recipient_id', Value: tagValue(trace.recipientId) },
          { Name: 'send_attempt_id', Value: tagValue(trace.sendAttemptId) },
          ...(trace.tenantId ? [{ Name: 'tenant_id', Value: tagValue(trace.tenantId) }] : []),
        ] } : {}),
      }));
      const messageId = response.MessageId || '';
      logger.info('SES email accepted', {
        campaign_id: trace?.campaignId, recipient_id: trace?.recipientId,
        send_attempt_id: trace?.sendAttemptId, ses_message_id: messageId,
      });
      return { messageId, provider: 'ses' };
    } catch (error) {
      throw this.normalizeError(error, options.to);
    }
  }

  async getSendingLimits(): Promise<SendingLimits> {
    const account = await this.client.send(new GetAccountCommand({}));
    return {
      max24HourSend: account.SendQuota?.Max24HourSend ?? null,
      maxSendRate: account.SendQuota?.MaxSendRate ?? null,
      sentLast24Hours: account.SendQuota?.SentLast24Hours ?? null,
    };
  }

  async verifySender(identity: string): Promise<SenderVerification> {
    const result = await this.client.send(new GetEmailIdentityCommand({ EmailIdentity: identity }));
    const status = result.VerificationStatus || 'UNKNOWN';
    return { identity, verified: status === 'SUCCESS', status };
  }

  async verifyConnection(): Promise<boolean> {
    try { await this.getSendingLimits(); return true; }
    catch (error) { logger.error('SES connection failed', { error: (error as Error).message }); return false; }
  }

  private normalizeError(error: unknown, recipient: string): Error {
    const err = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    const message = err.message || 'Unknown SES error';
    const statusCode = err.$metadata?.httpStatusCode;
    if (err.name === 'TooManyRequestsException' || err.name === 'ThrottlingException' || statusCode === 429) return new RateLimitError(`SES rate limit: ${message}`);
    if (err.name === 'MessageRejected' || err.name === 'BadRequestException') return new PermanentBounceError(`SES rejected: ${message}`, err.name, recipient);
    if (err.name === 'NotFoundException' || err.name === 'MailFromDomainNotVerifiedException' || err.name === 'AccountSuspendedException' || err.name === 'SendingPausedException') return new AuthenticationError(`SES configuration error: ${message}`);
    if ((statusCode && statusCode >= 500) || err.name === 'ServiceUnavailableException' || err.name === 'TimeoutError') return new TemporaryBounceError(`SES service error: ${message}`, String(statusCode || err.name), recipient);
    logger.error('SES unclassified send error', { error: message, name: err.name, statusCode });
    return error instanceof Error ? error : new Error(message);
  }
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
