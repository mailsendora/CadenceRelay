import { Router } from 'express';
import { checkEmailQuality } from '../controllers/emailQuality.controller';

const router = Router();
router.post('/check', checkEmailQuality);
export default router;
