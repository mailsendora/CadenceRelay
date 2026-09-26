import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { generateEmail } from '../services/ai/emailGenerationService';

const schema = z.object({
  domain: z.enum(['ecommerce', 'saas', 'education', 'healthcare', 'real_estate', 'finance', 'nonprofit', 'hospitality', 'professional_services', 'general']),
  goal: z.string().trim().min(2).max(200),
  tone: z.enum(['professional', 'friendly', 'persuasive', 'concise', 'warm']),
  language: z.string().trim().min(2).max(50),
  audience: z.string().trim().min(2).max(500),
  prompt: z.string().trim().min(10).max(5000),
  sender: z.string().trim().max(320).optional(),
});

export async function generateAiEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Invalid generation request.', 400);
    const result = await generateEmail(parsed.data);
    res.json({ email: result });
  } catch (error) {
    next(error);
  }
}

