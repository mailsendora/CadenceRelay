import { Request, Response } from 'express';
import { analyzeEmailQuality } from '../services/emailQuality/emailQualityService';

export function checkEmailQuality(req: Request, res: Response): void {
  res.json(analyzeEmailQuality(req.body || {}));
}
