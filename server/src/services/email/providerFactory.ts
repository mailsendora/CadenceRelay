import { EmailProvider } from './EmailProvider';
import { GmailProvider } from './GmailProvider';
import { SESProvider } from './SESProvider';
import { decryptCredential, isEncrypted } from '../../utils/crypto';

/**
 * Decrypt a credential value if it's encrypted, otherwise return as-is.
 * This provides backwards compatibility with unencrypted configs.
 */
function maybeDecrypt(value: string): string {
  if (!value) return value;
  // Decrypt iteratively — handles double-encryption from masked-value bug
  let current = value;
  for (let i = 0; i < 5; i++) { // max 5 layers of encryption
    if (!isEncrypted(current)) break;
    const decrypted = decryptCredential(current);
    if (decrypted === null) break; // decryption failed, return what we have
    current = decrypted;
  }
  return current;
}

export function createProvider(provider: string, config: Record<string, unknown>): EmailProvider {
  switch (provider) {
    case 'gmail': {
      // `fromEmail` is optional and lets the visible sender differ from the
      // SMTP auth username (required for Brevo/Mailgun/Postmark relays).
      const gmailConfig = config as {
        host: string;
        port: number;
        user: string;
        pass: string;
        fromName?: string;
        fromEmail?: string;
      };
      return new GmailProvider({
        ...gmailConfig,
        pass: maybeDecrypt(gmailConfig.pass),
      });
    }
    case 'ses': {
      const sesConfig = config as { region: string; accessKeyId?: string; secretAccessKey?: string; sessionToken?: string; fromEmail: string; fromName?: string; configurationSetName?: string; endpoint?: string };
      return new SESProvider({
        ...sesConfig,
        region: sesConfig.region || process.env.AWS_REGION || 'us-east-1',
        fromEmail: sesConfig.fromEmail || process.env.SES_FROM_EMAIL || '',
        configurationSetName: sesConfig.configurationSetName || process.env.SES_CONFIGURATION_SET || undefined,
        endpoint: sesConfig.endpoint || process.env.AWS_ENDPOINT_URL || undefined,
        accessKeyId: maybeDecrypt(sesConfig.accessKeyId || '') || undefined,
        secretAccessKey: maybeDecrypt(sesConfig.secretAccessKey || '') || undefined,
        sessionToken: maybeDecrypt(sesConfig.sessionToken || '') || undefined,
      });
    }
    default:
      throw new Error(`Unknown email provider: ${provider}`);
  }
}
