import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AuthService } from '../services/authService';

const router = Router();
const authService = new AuthService();
const JWT_SECRET = process.env.JWT_SECRET ?? 'changeme-in-production';

const loginSchema = z.object({
  email: z.string().min(1), // accepts plain username (e.g. 'admin') or email
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await authService.login(parsed.data.email, parsed.data.password);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Authentication failed';
    res.status(401).json({ success: false, error: message });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid request' });
    return;
  }
  try {
    const result = await authService.refreshToken(parsed.data.refreshToken);
    res.json({ success: true, data: result });
  } catch {
    res.status(401).json({ success: false, error: 'Invalid refresh token' });
  }
});

// POST /api/auth/token  — OAuth2 client_credentials
router.post('/token', async (req: Request, res: Response) => {
  const { client_id, client_secret, grant_type } = req.body as Record<string, string>;
  if (grant_type !== 'client_credentials') {
    res.status(400).json({ error: 'unsupported_grant_type' });
    return;
  }
  try {
    const result = await authService.clientCredentials(client_id, client_secret);
    res.json(result);
  } catch {
    res.status(401).json({ error: 'invalid_client' });
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// POST /api/auth/change-password — requires Bearer token
router.post('/change-password', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  let partnerId: string;
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { partnerId: string };
    partnerId = payload.partnerId;
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
    return;
  }

  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    await authService.changePassword(partnerId, parsed.data.currentPassword, parsed.data.newPassword);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to change password';
    res.status(400).json({ success: false, error: message });
  }
});

export { router as authRoutes };
