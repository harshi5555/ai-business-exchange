import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export const generateId = (): string => uuidv4();

// HMAC-SHA256 webhook signature
export const signPayload = (payload: string, secret: string): string => {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
};

export const verifySignature = (payload: string, secret: string, signature: string): boolean => {
  const expected = signPayload(payload, secret);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};

// Hash an API key for storage
export const hashApiKey = (apiKey: string): string => {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
};

// Generate a random API key
export const generateApiKey = (): string => {
  return `bx_${crypto.randomBytes(32).toString('hex')}`;
};

// Paginate arrays
export const paginate = <T>(items: T[], page: number, pageSize: number) => {
  const start = (page - 1) * pageSize;
  return {
    data: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
  };
};

// Sleep utility
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Exponential backoff delay
export const backoffDelay = (attempt: number, baseMs = 1000, maxMs = 30000): number =>
  Math.min(baseMs * Math.pow(2, attempt), maxMs);

// Safe JSON parse
export const safeJsonParse = <T>(str: string): T | null => {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
};
