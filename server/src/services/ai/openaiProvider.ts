import OpenAI from 'openai';
import { AppError } from '../../middleware/errorHandler';

export interface GeneratedEmailContent {
  subject: string;
  previewText: string;
  html: string;
  text: string;
}

const emailSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'previewText', 'html', 'text'],
  properties: {
    subject: { type: 'string', minLength: 1, maxLength: 200 },
    previewText: { type: 'string', minLength: 1, maxLength: 300 },
    html: { type: 'string', minLength: 1 },
    text: { type: 'string', minLength: 1 },
  },
} as const;

export async function generateStructuredEmail(prompt: string, instructions: string): Promise<{
  content: GeneratedEmailContent;
  model: string;
  requestId?: string;
  usage?: unknown;
}> {
  const provider = (process.env.AI_EMAIL_PROVIDER || 'openai').toLowerCase();
  const apiKey = provider === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AppError(`AI email generation is not configured. Add ${provider === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY'} to the server environment.`, 503);
  }
  if (process.env.AI_EMAIL_GENERATION_ENABLED === 'false') {
    throw new AppError('AI email generation is disabled.', 503);
  }

  const model = provider === 'groq' ? (process.env.GROQ_EMAIL_MODEL || 'llama-3.1-8b-instant') : (process.env.OPENAI_MODEL || 'gpt-5-mini');
  const client = new OpenAI({
    apiKey,
    ...(provider === 'groq' ? { baseURL: 'https://api.groq.com/openai/v1' } : {}),
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 45000),
    maxRetries: Number(process.env.OPENAI_MAX_RETRIES || 2),
  });

  try {
    if (provider === 'groq') {
      const response = await client.chat.completions.create({ model, messages: [{ role: 'system', content: instructions }, { role: 'user', content: prompt }], response_format: { type: 'json_object' }, max_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 4000) });
      const text = response.choices[0]?.message?.content;
      if (!text) throw new AppError('The AI provider returned no email content.', 502);
      return { content: JSON.parse(text) as GeneratedEmailContent, model, requestId: response.id, usage: response.usage };
    }
    const response = await client.responses.create({
      model,
      instructions,
      input: prompt,
      max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 4000),
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: 'sendora_email_content',
          strict: true,
          schema: emailSchema,
        },
      },
    });
    if (!response.output_text) throw new AppError('The AI provider returned no email content.', 502);
    return {
      content: JSON.parse(response.output_text) as GeneratedEmailContent,
      model,
      requestId: (response as { _request_id?: string })._request_id,
      usage: response.usage,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const status = (error as { status?: number }).status;
    if (status === 401) throw new AppError('OpenAI API key is invalid.', 503);
    if (status === 429) throw new AppError('AI generation rate limit reached. Please retry shortly.', 429);
    throw new AppError('AI email generation failed. Please retry.', 502);
  }
}
