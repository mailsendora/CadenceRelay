export interface EmailQualityInput { subject?: string; from?: string; replyTo?: string; html?: string; text?: string; }
export interface QualityFinding { code: string; message: string; }
export interface EmailQualityResult {
  score: number; errors: QualityFinding[]; warnings: QualityFinding[]; recommendations: QualityFinding[];
  disclaimer: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BYTES = 10 * 1024 * 1024;

export function analyzeEmailQuality(input: EmailQualityInput): EmailQualityResult {
  const errors: QualityFinding[] = [];
  const warnings: QualityFinding[] = [];
  const recommendations: QualityFinding[] = [];
  const error = (code: string, message: string) => errors.push({ code, message });
  const warning = (code: string, message: string) => warnings.push({ code, message });
  const recommend = (code: string, message: string) => recommendations.push({ code, message });
  const html = input.html || '';

  if (!input.subject?.trim()) error('subject_missing', 'Add a non-empty subject.');
  if (!input.from?.trim()) error('sender_missing', 'Add a sender address.');
  else if (!EMAIL.test(extractAddress(input.from))) error('sender_invalid', 'The sender address is invalid.');
  if (input.replyTo && !EMAIL.test(extractAddress(input.replyTo))) error('reply_to_invalid', 'The Reply-To address is invalid.');
  if (!html.trim()) error('html_missing', 'Add HTML content.');
  if (!input.text?.trim()) warning('text_missing', 'Add a plain-text alternative.');
  if (Buffer.byteLength(html + (input.text || ''), 'utf8') > MAX_BYTES) error('message_too_large', 'Message content exceeds the configured 10 MB quality limit.');
  if (html && !balanced(html, 'table')) warning('malformed_html', 'HTML contains unbalanced table tags.');

  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(match => match[1]);
  const invalidLinks = links.filter(link => !/^(https?:|mailto:|#|\{\{)/i.test(link));
  if (invalidLinks.length) warning('invalid_links', `${invalidLinks.length} link(s) use an invalid or unsupported URL.`);
  if (links.length > 30) warning('excessive_links', `Message contains ${links.length} links.`);
  if (!/unsubscribe/i.test(html)) error('unsubscribe_missing', 'Include a visible unsubscribe link.');
  if (!/\{\{\s*unsubscribe_url\s*\}\}|\/u\//i.test(html)) recommend('one_click_unsubscribe', 'Use the secure unsubscribe URL variable; delivery adds List-Unsubscribe headers.');

  const images = [...html.matchAll(/<img\b([^>]*)>/gi)];
  const missingAlt = images.filter(match => !/\balt\s*=/i.test(match[1])).length;
  if (missingAlt) warning('image_alt_missing', `${missingAlt} image(s) are missing alt text.`);
  const visibleText = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim();
  if (images.length >= 2 && visibleText.length < 120) warning('image_only_content', 'The message appears image-heavy with little readable text.');

  const score = Math.max(0, 100 - errors.length * 20 - warnings.length * 7 - recommendations.length * 2);
  return { score, errors, warnings, recommendations, disclaimer: 'This is an internal content-quality score, not a prediction or guarantee of inbox placement.' };
}

const extractAddress = (value: string): string => value.match(/<([^>]+)>/)?.[1]?.trim() || value.trim();
const balanced = (html: string, tag: string): boolean =>
  (html.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length === (html.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
