import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { generateAiEmail } from '../controllers/aiEmail.controller';

const router = Router();
const generationLimiter = rateLimit({
  windowMs: Number(process.env.AI_RATE_LIMIT_WINDOW_MS || 60_000),
  limit: Number(process.env.AI_RATE_LIMIT_REQUESTS || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many AI generation requests. Please retry shortly.' },
});

router.post('/generate', generationLimiter, generateAiEmail);

export default router;
