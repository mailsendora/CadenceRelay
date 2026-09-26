import { Request, Response, NextFunction } from 'express';
import https from 'https';
import { logger } from '../utils/logger';
import { eventProcessingQueue } from '../queues/emailQueue';
import { processSesEvent } from '../services/email/sesEventProcessor';
import { verifySnsEnvelope } from '../services/email/snsSignatureVerifier';

export async function handleSnsWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (process.env.SES_SNS_VERIFY_SIGNATURE !== 'false' && !(await verifySnsEnvelope(req.body))) {
      logger.warn('Rejected SNS webhook with invalid signature');
      res.status(401).send('Invalid SNS signature');
      return;
    }
    const messageType = req.headers['x-amz-sns-message-type'];
    if (messageType === 'SubscriptionConfirmation') {
      const subscribeUrl = new URL(req.body.SubscribeURL);
      if (subscribeUrl.protocol !== 'https:' || !/^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/i.test(subscribeUrl.hostname)) {
        res.status(400).send('Invalid subscription URL');
        return;
      }
      https.get(subscribeUrl).on('error', error => logger.error('SNS confirmation failed', { error: error.message }));
      res.status(200).send('OK');
      return;
    }
    if (messageType === 'Notification') {
      let message: Record<string, unknown>;
      try { message = JSON.parse(req.body.Message || '{}'); }
      catch { res.status(400).send('Invalid message format'); return; }
      const notificationType = String(message.notificationType || message.eventType || '');
      await eventProcessingQueue.add('process-sns', { notificationType, message }, { jobId: req.body.MessageId });
    }
    res.status(200).send('OK');
  } catch (error) {
    next(error);
  }
}

export async function processSnsEvent(notificationType: string, message: Record<string, unknown>): Promise<void> {
  await processSesEvent({ ...message, notificationType });
}
