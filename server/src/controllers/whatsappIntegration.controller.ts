import { NextFunction, Request, Response } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import jwt from 'jsonwebtoken';

function userId(req: Request): string {
  if (!req.user?.userId) throw new AppError('Authentication required', 401);
  return req.user.userId;
}

export async function getWhatsAppIntegration(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT id, senqo_user_id, senqo_workspace_id, status, metadata, created_at, updated_at
       FROM integration.whatsapp_integrations WHERE sendora_user_id = $1`, [userId(req)]
    );
    res.json({ integration: result.rows[0] || null });
  } catch (error) { next(error); }
}

export async function linkWhatsAppWorkspace(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { senqoUserId, senqoWorkspaceId } = req.body || {};
    if (typeof senqoUserId !== 'string' || typeof senqoWorkspaceId !== 'string' || !senqoUserId.trim() || !senqoWorkspaceId.trim()) {
      throw new AppError('senqoUserId and senqoWorkspaceId are required', 400);
    }
    const result = await pool.query(
      `INSERT INTO integration.whatsapp_integrations
        (sendora_user_id, senqo_user_id, senqo_workspace_id, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (sendora_user_id) DO UPDATE SET
         senqo_user_id = EXCLUDED.senqo_user_id,
         senqo_workspace_id = EXCLUDED.senqo_workspace_id,
         status = 'active', updated_at = NOW()
       RETURNING id, senqo_user_id, senqo_workspace_id, status, metadata, created_at, updated_at`,
      [userId(req), senqoUserId.trim(), senqoWorkspaceId.trim()]
    );
    res.json({ integration: result.rows[0] });
  } catch (error) { next(error); }
}

export async function unlinkWhatsAppWorkspace(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await pool.query(
      `UPDATE integration.whatsapp_integrations SET status = 'unlinked', updated_at = NOW()
       WHERE sendora_user_id = $1`, [userId(req)]
    );
    res.json({ ok: true });
  } catch (error) { next(error); }
}

/** Short-lived token consumed by the Senqo-side exchange endpoint. */
export async function createWhatsAppSsoToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const secret = process.env.SENQO_SSO_SHARED_SECRET;
    if (!secret) throw new AppError('WhatsApp SSO is not configured', 503);
    const result = await pool.query(
      `SELECT senqo_user_id, senqo_workspace_id FROM integration.whatsapp_integrations
       WHERE sendora_user_id = $1 AND status = 'active'`, [userId(req)]
    );
    const link = result.rows[0];
    if (!link?.senqo_user_id || !link.senqo_workspace_id) throw new AppError('WhatsApp workspace is not linked', 409);
    const token = jwt.sign({
      typ: 'sendora_senqo_bridge', sub: userId(req),
      senqoUserId: link.senqo_user_id, senqoWorkspaceId: link.senqo_workspace_id,
    }, secret, { algorithm: 'HS256', audience: 'senqo', issuer: 'sendora', expiresIn: '60s', jwtid: crypto.randomUUID() });
    res.json({ token, workspaceId: link.senqo_workspace_id, expiresIn: 60 });
  } catch (error) { next(error); }
}

export async function listCampaignLinks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params: unknown[] = [userId(req)];
    let where = 'sendora_user_id = $1';
    if (typeof req.query.campaignId === 'string' && req.query.campaignId.trim()) {
      params.push(req.query.campaignId.trim());
      where += ` AND sendora_campaign_id = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT * FROM integration.campaign_links WHERE ${where} ORDER BY created_at DESC`, params
    );
    res.json({ links: result.rows });
  } catch (error) { next(error); }
}

export async function createCampaignLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body || {};
    if (typeof body.sendoraCampaignId !== 'string' || !body.sendoraCampaignId.trim()) throw new AppError('sendoraCampaignId is required', 400);
    if (!body.senqoFlowId && !body.senqoCampaignId) throw new AppError('senqoFlowId or senqoCampaignId is required', 400);
    const integration = await pool.query(
      `SELECT senqo_workspace_id FROM integration.whatsapp_integrations
       WHERE sendora_user_id = $1 AND status = 'active'`, [userId(req)]
    );
    if (!integration.rows[0]) throw new AppError('WhatsApp workspace is not linked', 409);
    const result = await pool.query(
      `INSERT INTO integration.campaign_links
        (sendora_user_id, project_id, sendora_campaign_id, senqo_workspace_id, senqo_campaign_id, senqo_flow_id, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'sendora_email') RETURNING *`,
      [userId(req), body.projectId || null, body.sendoraCampaignId, integration.rows[0].senqo_workspace_id,
        body.senqoCampaignId || null, body.senqoFlowId || null]
    );
    res.status(201).json({ link: result.rows[0] });
  } catch (error) { next(error); }
}

export async function deleteCampaignLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `UPDATE integration.campaign_links SET status = 'unlinked', updated_at = NOW()
       WHERE id = $1 AND sendora_user_id = $2 RETURNING id`, [req.params.id, userId(req)]
    );
    if (!result.rows[0]) throw new AppError('Campaign link not found', 404);
    res.json({ ok: true });
  } catch (error) { next(error); }
}
