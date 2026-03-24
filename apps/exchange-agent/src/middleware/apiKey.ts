import { Request, Response, NextFunction } from 'express';
import { getPool } from '@bx/database';
import { hashApiKey } from '@bx/shared-utils';
import { createLogger } from '@bx/logger';

const logger = createLogger('exchange-agent:apiKey');

export interface AuthenticatedRequest extends Request {
  partnerId?: string;
}

export async function apiKeyMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = req.headers['x-api-key'] as string | undefined;
  if (!key) {
    res.status(401).json({ success: false, error: 'API key required' });
    return;
  }
  try {
    const db = getPool();
    const hash = hashApiKey(key);
    const { rows } = await db.query<{ partner_id: string }>(
      `SELECT partner_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL LIMIT 1`,
      [hash],
    );
    if (rows.length === 0) {
      res.status(403).json({ success: false, error: 'Invalid or revoked API key' });
      return;
    }
    req.partnerId = rows[0].partner_id;
    next();
  } catch (err) {
    logger.error({ err }, 'API key validation error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
