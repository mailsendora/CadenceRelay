import pg from 'pg';
import { pool } from '../../config/database';
import { logger } from '../../utils/logger';

const { Pool } = pg;
let senqoPool: pg.Pool | null = null;

function getSenqoPool(): pg.Pool | null {
  const url = process.env.SENQO_DATABASE_URL?.trim();
  if (!url) return null;
  senqoPool ??= new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 5000 });
  return senqoPool;
}

/** One-way Sendora → Senqo CRM sync. Sendora remains the canonical contact store. */
export async function syncWhatsAppContacts(limit = 1000): Promise<number> {
  const target = getSenqoPool();
  if (!target) return 0;
  const links = await pool.query(`SELECT sendora_user_id, senqo_workspace_id FROM integration.whatsapp_integrations WHERE status='active' AND senqo_workspace_id IS NOT NULL`);
  let synced = 0;
  for (const link of links.rows) {
    const source = await pool.query(
      `SELECT id, email, name, metadata FROM contacts
        WHERE status='active' AND metadata ?| ARRAY['phone','phone_e164','whatsapp_phone']
          AND COALESCE((metadata->>'whatsapp_opt_in')::boolean, false) = true
        ORDER BY updated_at DESC LIMIT $1`, [limit],
    );
    for (const contact of source.rows) {
      const phone = String(contact.metadata.phone_e164 ?? contact.metadata.whatsapp_phone ?? contact.metadata.phone ?? '').replace(/[^0-9+]/g, '');
      if (phone.length < 7) continue;
      const parts = String(contact.name ?? contact.email.split('@')[0]).trim().split(/\s+/);
      const first = parts.shift() || 'Contact';
      const last = parts.join(' ') || '';
      const result = await target.query(
        `INSERT INTO contacts (workspace_id, first_name, last_name, phone, metadata)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (workspace_id, phone) DO UPDATE SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, metadata=contacts.metadata || EXCLUDED.metadata
         RETURNING id`, [link.senqo_workspace_id, first, last, phone, JSON.stringify({ email: contact.email, sendora_contact_id: contact.id, source: 'sendora' })],
      );
      await pool.query(
        `INSERT INTO integration.contact_identities (sendora_user_id, sendora_contact_id, senqo_workspace_id, senqo_contact_id, email_normalized, phone_e164, match_method, match_confidence, whatsapp_opt_in)
         VALUES ($1,$2,$3,$4,$5,$6,'exact_phone',1.0,true)
         ON CONFLICT (sendora_user_id, sendora_contact_id) DO UPDATE SET senqo_contact_id=EXCLUDED.senqo_contact_id, phone_e164=EXCLUDED.phone_e164, updated_at=NOW()`,
        [link.sendora_user_id, contact.id, link.senqo_workspace_id, result.rows[0].id, contact.email.toLowerCase(), phone],
      );
      synced += 1;
    }
  }
  if (synced) logger.info('WhatsApp contact sync completed', { synced });
  return synced;
}
