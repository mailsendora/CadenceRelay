import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { processSesEvent } from '../services/email/sesEventProcessor';
import { logger } from '../utils/logger';

export interface SesSqsPoller { stop(): void; done: Promise<void>; }

export function startSesSqsEventPoller(): SesSqsPoller | null {
  const queueUrl = process.env.SES_EVENT_QUEUE_URL;
  if (!queueUrl) return null;
  const abort = new AbortController();
  const client = new SQSClient({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
    ...(process.env.AWS_ENDPOINT_URL ? { endpoint: process.env.AWS_ENDPOINT_URL } : {}),
  });
  const done = poll(client, queueUrl, abort.signal);
  return { stop: () => abort.abort(), done };
}

async function poll(client: SQSClient, queueUrl: string, signal: AbortSignal): Promise<void> {
  logger.info('SES SQS event poller started', { queue_url: queueUrl });
  while (!signal.aborted) {
    try {
      const response = await client.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20, VisibilityTimeout: 60,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }), { abortSignal: signal });
      for (const message of response.Messages || []) {
        if (!message.Body || !message.ReceiptHandle) continue;
        const payload = JSON.parse(message.Body) as Record<string, unknown>;
        await processSesEvent(payload, typeof payload.id === 'string' ? payload.id : message.MessageId);
        await client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
      }
    } catch (error) {
      if (signal.aborted) break;
      logger.error('SES SQS event polling failed', { error: (error as Error).message });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
