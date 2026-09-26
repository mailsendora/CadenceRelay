import apiClient from './client';

export type AiEmailDomain = 'ecommerce' | 'saas' | 'education' | 'healthcare' | 'real_estate' | 'finance' | 'nonprofit' | 'hospitality' | 'professional_services' | 'general';
export type AiEmailTone = 'professional' | 'friendly' | 'persuasive' | 'concise' | 'warm';

export interface AiQualityFinding { code: string; message: string; }
export interface AiGeneratedEmail {
  subject: string;
  previewText: string;
  html: string;
  text: string;
  quality: {
    score: number;
    errors: AiQualityFinding[];
    warnings: AiQualityFinding[];
    recommendations: AiQualityFinding[];
    disclaimer: string;
  };
  model: string;
  requestId?: string;
}

export interface GenerateAiEmailInput {
  domain: AiEmailDomain;
  goal: string;
  tone: AiEmailTone;
  language: string;
  audience: string;
  prompt: string;
  sender?: string;
}

export async function generateAiEmail(input: GenerateAiEmailInput): Promise<AiGeneratedEmail> {
  const response = await apiClient.post('/ai/email/generate', input);
  return response.data.email;
}

