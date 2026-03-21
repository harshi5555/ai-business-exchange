import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PartnerService } from '../services/partnerService';

const router = Router();
const svc = new PartnerService();

const createPartnerSchema = z.object({
  name: z.string().min(2).max(200),
  domain: z.string().min(3).max(253),
  contactEmail: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  webhookUrl: z.string().url().optional(),
  supportedFormats: z.array(z.enum(['json', 'xml', 'csv', 'edi-x12', 'edifact'])).min(1),
});

// POST /api/partners — self-register
router.post('/', async (req: Request, res: Response) => {
  const parsed = createPartnerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }
  try {
    const partner = await svc.register(parsed.data);
    res.status(201).json({ success: true, data: partner });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Registration failed';
    res.status(409).json({ success: false, error: message });
  }
});

// GET /api/partners — catalog (approved only)
router.get('/', async (req: Request, res: Response) => {
  const page = parseInt(req.query['page'] as string ?? '1');
  const pageSize = parseInt(req.query['pageSize'] as string ?? '20');
  const result = await svc.listApproved({ page, pageSize });
  res.json({ success: true, ...result });
});

// GET /api/partners/platform-branding — platform default branding (public)
router.get('/platform-branding', async (_req: Request, res: Response) => {
  try {
    const branding = await svc.getPlatformBranding();
    res.json({ success: true, data: branding });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to get platform branding' });
  }
});

// PUT /api/partners/platform-branding — admin only
router.put('/platform-branding', async (req: Request, res: Response) => {
  const isAdmin = req.headers['x-partner-id'] === '00000000-0000-0000-0000-000000000001';
  if (!isAdmin) {
    res.status(403).json({ success: false, error: 'Admin only' });
    return;
  }
  try {
    const branding = await svc.updatePlatformBranding(req.body as Record<string, unknown>);
    res.json({ success: true, data: branding });
  } catch {
    res.status(500).json({ success: false, error: 'Update failed' });
  }
});

// GET /api/partners/:id
router.get('/:id', async (req: Request, res: Response) => {
  const partner = await svc.findById(req.params.id);
  if (!partner) {
    res.status(404).json({ success: false, error: 'Partner not found' });
    return;
  }
  res.json({ success: true, data: partner });
});

// GET /api/partners/:id/branding — get partner branding
router.get('/:id/branding', async (req: Request, res: Response) => {
  try {
    const branding = await svc.getBranding(req.params.id);
    res.json({ success: true, data: branding });
  } catch {
    res.status(404).json({ success: false, error: 'Partner not found' });
  }
});

// PUT /api/partners/:id/branding — update own branding
router.put('/:id/branding', async (req: Request, res: Response) => {
  const requestingPartnerId = req.headers['x-partner-id'] as string;
  const isAdmin = requestingPartnerId === '00000000-0000-0000-0000-000000000001';
  if (!isAdmin && requestingPartnerId !== req.params.id) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }
  try {
    const branding = await svc.updateBranding(req.params.id, req.body as Record<string, unknown>);
    res.json({ success: true, data: branding });
  } catch {
    res.status(500).json({ success: false, error: 'Update failed' });
  }
});

// PUT /api/partners/:id — update own profile
router.put('/:id', async (req: Request, res: Response) => {
  const requestingPartnerId = req.headers['x-partner-id'] as string;
  if (requestingPartnerId !== req.params.id) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }
  try {
    const updated = await svc.update(req.params.id, req.body as Record<string, unknown>);
    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, error: 'Update failed' });
  }
});

// Internal endpoint — returns decrypted LLM config for integration-service use only.
// Only accessible from within the cluster (no JWT required on this internal call).
router.get('/:id/llm-config', async (req: Request, res: Response) => {
  try {
    const config = await svc.getLLMConfig(req.params.id);
    res.json({ success: true, data: config });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch LLM config' });
  }
});

// Internal endpoint — returns decrypted platform-default LLM config for service-to-service use only.
router.get('/internal/platform-llm-config', async (_req: Request, res: Response) => {
  try {
    const config = await svc.getPlatformLLMConfig();
    res.json({ success: true, data: config });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch platform LLM config' });
  }
});

export { router as partnerRoutes };
