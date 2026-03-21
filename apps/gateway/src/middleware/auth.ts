import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '@bx/shared-types';

declare global {
  namespace Express {
    interface Request {
      partner?: JwtPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const apiKey = req.headers['x-api-key'] as string | undefined;

  // API key auth
  if (apiKey) {
    // Forward to downstream service for validation
    req.headers['x-partner-api-key'] = apiKey;
    next();
    return;
  }

  // JWT auth
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const secret = process.env.JWT_SECRET ?? 'changeme';
    const payload = jwt.verify(token, secret) as JwtPayload;
    req.partner = payload;
    req.headers['x-partner-id'] = payload.partnerId;
    req.headers['x-partner-scopes'] = payload.scopes.join(',');
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}
