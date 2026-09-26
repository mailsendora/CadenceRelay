export const DOMAIN_PRESETS = {
  ecommerce: 'E-commerce and retail: focus on product value, clear offers, trust, and a direct CTA.',
  saas: 'SaaS: explain the problem, product outcome, proof, and one low-friction CTA.',
  education: 'Education: be clear, credible, student-friendly, and specific about learning outcomes.',
  healthcare: 'Healthcare: use careful, non-alarmist language and avoid unsupported medical claims.',
  real_estate: 'Real estate: emphasize location, practical benefits, trust, and a clear enquiry CTA.',
  finance: 'Financial services: remain factual and avoid guarantees, pressure, or misleading return claims.',
  nonprofit: 'Non-profit: connect the mission to tangible impact and make the requested action explicit.',
  hospitality: 'Hospitality and travel: make the experience vivid while keeping dates, terms, and CTA clear.',
  professional_services: 'Professional services: lead with expertise, business outcomes, evidence, and consultation CTA.',
  general: 'General business communication: concise, credible, accessible, and action-oriented.',
} as const;

export type EmailDomain = keyof typeof DOMAIN_PRESETS;

