import { Router } from 'express';
import { trackOpen, trackClick, unsubscribeGet, unsubscribePost, preferenceCenterGet, preferenceCenterPost } from '../controllers/tracking.controller';

const router = Router();

router.get('/o/:token', trackOpen);
router.get('/c/:token/:linkIndex', trackClick);
router.get('/u/:token', unsubscribeGet);
router.post('/u/:token', unsubscribePost);
router.get('/p/:token', preferenceCenterGet);
router.post('/p/:token', preferenceCenterPost);

export default router;
