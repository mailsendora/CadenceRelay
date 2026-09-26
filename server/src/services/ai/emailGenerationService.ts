import sanitizeHtml from 'sanitize-html';
import { analyzeEmailQuality } from '../emailQuality/emailQualityService';
import { buildEmailPrompt, EMAIL_GENERATION_INSTRUCTIONS, EmailGenerationInput } from './emailPromptBuilder';
import { generateStructuredEmail } from './openaiProvider';

function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'html', 'head', 'body', 'meta', 'title', 'table', 'tbody', 'thead', 'tfoot',
      'tr', 'td', 'th', 'img', 'span', 'div', 'section', 'header', 'footer', 'center', 'button',
    ]),
    allowedAttributes: {
      '*': ['class', 'style', 'title', 'align', 'valign', 'width', 'height', 'role', 'aria-label'],
      a: ['href', 'target', 'rel', 'style', 'class', 'title'],
      img: ['src', 'alt', 'width', 'height', 'style', 'class'],
      meta: ['charset', 'name', 'content'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid'] },
    allowProtocolRelative: false,
  });
}

export async function generateEmail(input: EmailGenerationInput) {
  const generated = await generateStructuredEmail(buildEmailPrompt(input), EMAIL_GENERATION_INSTRUCTIONS);
  const html = sanitizeEmailHtml(generated.content.html);
  const content = { ...generated.content, html };
  const quality = analyzeEmailQuality({
    subject: content.subject,
    from: input.sender || process.env.SES_FROM_EMAIL,
    html: content.html,
    text: content.text,
  });
  return { ...content, quality, model: generated.model, requestId: generated.requestId, usage: generated.usage };
}
