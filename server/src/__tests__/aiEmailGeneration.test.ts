jest.mock('../services/ai/openaiProvider', () => ({ generateStructuredEmail: jest.fn() }));

import { buildEmailPrompt } from '../services/ai/emailPromptBuilder';
import { generateEmail } from '../services/ai/emailGenerationService';
import { generateStructuredEmail } from '../services/ai/openaiProvider';

const mockedGenerate = generateStructuredEmail as jest.MockedFunction<typeof generateStructuredEmail>;

describe('AI email generation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds a domain-aware prompt', () => {
    const prompt = buildEmailPrompt({
      domain: 'education', goal: 'Webinar registration', tone: 'friendly', language: 'Hindi',
      audience: 'School principals', prompt: 'Invite principals to a practical teaching webinar.',
    });
    expect(prompt).toContain('Education:');
    expect(prompt).toContain('School principals');
    expect(prompt).toContain('Hindi');
    expect(prompt).toContain('{{unsubscribe_url}}');
  });

  it('sanitizes generated HTML and runs the quality engine', async () => {
    mockedGenerate.mockResolvedValue({
      model: 'test-model', requestId: 'req_test', usage: {},
      content: {
        subject: 'A useful update', previewText: 'See what is new',
        html: '<div><script>alert(1)</script><p>Hello {{name}}</p><a href="{{unsubscribe_url}}">Unsubscribe</a></div>',
        text: 'Hello. Unsubscribe using the link in this message.',
      },
    });
    const result = await generateEmail({
      domain: 'general', goal: 'Update', tone: 'professional', language: 'English',
      audience: 'Customers', prompt: 'Write a useful product update email.', sender: 'hello@example.com',
    });
    expect(result.html).not.toContain('<script');
    expect(result.html).toContain('{{unsubscribe_url}}');
    expect(result.quality.errors).toEqual([]);
    expect(result.requestId).toBe('req_test');
  });
});
