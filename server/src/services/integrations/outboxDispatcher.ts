import { pool } from '../../config/database';
import { logger } from '../../utils/logger';

const MAX_ATTEMPTS = Number(process.env.SENQO_OUTBOX_MAX_ATTEMPTS ?? 8);
const WEBHOOK_URL = process.env.SENQO_AUTOMATION_WEBHOOK_URL?.trim() ?? '';
const WEBHOOK_SECRET = process.env.SENQO_AUTOMATION_WEBHOOK_SECRET?.trim() ?? '';

/** Delivers cross-channel actions without losing events on transient Senqo/network failures. */
export async function dispatchSenqoOutboxBatch(limit = 25): Promise<number> {
  if (!WEBHOOK_URL) return 0;
  const client = await pool.connect();
  let delivered = 0;
  try {
    const { rows } = await client.query(
      `SELECT id, action_key, action_type, payload, attempts
         FROM integration.outbox
        WHERE destination = 'senqo' AND status = 'pending' AND next_attempt_at <= NOW()
        ORDER BY next_attempt_at, created_at
        FOR UPDATE SKIP LOCKED LIMIT $1`, [limit],
    );
    for (const row of rows) {
      await client.query(`UPDATE integration.outbox SET status='processing', attempts=attempts+1 WHERE id=$1`, [row.id]);
      try {
        const response = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(WEBHOOK_SECRET ? { authorization: `Bearer ${WEBHOOK_SECRET}` } : {}) },
          body: JSON.stringify({ actionKey: row.action_key, actionType: row.action_type, payload: row.payload }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`Senqo webhook HTTP ${response.status}`);
        await client.query(`UPDATE integration.outbox SET status='sent', processed_at=NOW() WHERE id=$1`, [row.id]);
        delivered += 1;
      } catch (error) {
        const attempts = Number(row.attempts) + 1;
        const terminal = attempts >= MAX_ATTEMPTS;
        const delay = Math.min(3600, 2 ** Math.min(attempts, 10)) + Math.floor(Math.random() * 10);
        await client.query(
          `UPDATE integration.outbox
              SET status=$2, last_error=$3, next_attempt_at=NOW() + ($4 || ' seconds')::interval
            WHERE id=$1`,
          [row.id, terminal ? 'dead_letter' : 'pending', String(error), delay],
        );
        logger.warn('Senqo outbox delivery failed', { action_key: row.action_key, attempts, terminal, error: String(error) });
      }
    }
    return delivered;
  } finally {
    client.release();
  }
}
