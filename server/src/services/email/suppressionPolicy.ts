export const normalizeEmailAddress = (email: string): string => email.trim().toLowerCase();
export const shouldSuppressBounce = (bounceType: string | undefined): boolean => bounceType?.toLowerCase() === 'permanent';
