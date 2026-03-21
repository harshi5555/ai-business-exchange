import { Router, Request, Response } from 'express';
import { AuthService } from '../services/authService';

const router = Router();
const authService = new AuthService();

// POST /api/auth/keys — issue a new API key
router.post('/', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  if (!partnerId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  try {
    const { apiKey } = await authService.issueApiKey(partnerId);
    res.status(201).json({ success: true, data: { apiKey } });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to issue API key' });
  }
});

// DELETE /api/auth/keys/:key — revoke an API key
router.delete('/:keyId', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  try {
    await authService.revokeApiKey(partnerId, req.params.keyId);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to revoke API key' });
  }
});

export { router as apiKeyRoutes };
