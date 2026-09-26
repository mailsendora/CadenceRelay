import { Router } from 'express';
import {
  createCampaignLink, deleteCampaignLink, getWhatsAppIntegration, linkWhatsAppWorkspace,
  listCampaignLinks, unlinkWhatsAppWorkspace, createWhatsAppSsoToken,
} from '../controllers/whatsappIntegration.controller';

const router = Router();
router.get('/status', getWhatsAppIntegration);
router.post('/link', linkWhatsAppWorkspace);
router.delete('/link', unlinkWhatsAppWorkspace);
router.post('/sso-token', createWhatsAppSsoToken);
router.get('/campaign-links', listCampaignLinks);
router.post('/campaign-links', createCampaignLink);
router.delete('/campaign-links/:id', deleteCampaignLink);

export default router;
