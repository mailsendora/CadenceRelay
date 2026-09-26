import https from 'https';
import { createVerify } from 'crypto';

interface SnsEnvelope {
  Type?: string; Message?: string; MessageId?: string; Subject?: string; Timestamp?: string;
  TopicArn?: string; Signature?: string; SignatureVersion?: string; SigningCertURL?: string;
  SubscribeURL?: string; Token?: string;
}

const certCache = new Map<string, string>();

export async function verifySnsEnvelope(envelope: SnsEnvelope): Promise<boolean> {
  if (!envelope.Signature || !envelope.SigningCertURL || !envelope.SignatureVersion) return false;
  const certUrl = new URL(envelope.SigningCertURL);
  if (certUrl.protocol !== 'https:' || !/^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/i.test(certUrl.hostname) || !certUrl.pathname.endsWith('.pem')) return false;
  const certificate = certCache.get(certUrl.href) || await downloadCertificate(certUrl);
  certCache.set(certUrl.href, certificate);
  const verifier = createVerify(envelope.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1');
  verifier.update(canonicalMessage(envelope), 'utf8');
  return verifier.verify(certificate, envelope.Signature, 'base64');
}

function canonicalMessage(envelope: SnsEnvelope): string {
  const fields = envelope.Type === 'Notification'
    ? ['Message', 'MessageId', ...(envelope.Subject ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return fields.map(field => `${field}\n${String(envelope[field as keyof SnsEnvelope] || '')}\n`).join('');
}

function downloadCertificate(url: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`SNS certificate download returned ${response.statusCode}`)); return; }
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    }).on('error', reject);
  });
}
