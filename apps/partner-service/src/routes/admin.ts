import { Router, Request, Response } from 'express';
import { PartnerService } from '../services/partnerService';
import { DemoService } from '../services/demoService';

const router = Router();
const svc = new PartnerService();
const demo = new DemoService();

// Admin-only middleware (scope check)
router.use((req: Request, res: Response, next) => {
  const scopes = (req.headers['x-partner-scopes'] as string ?? '').split(',');
  if (!scopes.includes('admin')) {
    res.status(403).json({ success: false, error: 'Admin scope required' });
    return;
  }
  next();
});

// GET /api/partners/admin/all
router.get('/all', async (_req: Request, res: Response) => {
  const partners = await svc.listAll();
  res.json({ success: true, data: partners });
});

// GET /api/partners/admin/pending
router.get('/pending', async (_req: Request, res: Response) => {
  const partners = await svc.listPending();
  res.json({ success: true, data: partners });
});

// POST /api/partners/admin/:id/approve
router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const partner = await svc.approve(req.params.id);
    res.json({ success: true, data: partner });
  } catch {
    res.status(404).json({ success: false, error: 'Partner not found' });
  }
});

// POST /api/partners/admin/:id/reject
router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const partner = await svc.reject(req.params.id, (req.body as { reason?: string }).reason);
    res.json({ success: true, data: partner });
  } catch {
    res.status(404).json({ success: false, error: 'Partner not found' });
  }
});

// POST /api/partners/admin/:id/suspend
router.post('/:id/suspend', async (req: Request, res: Response) => {
  try {
    const partner = await svc.suspend(req.params.id);
    res.json({ success: true, data: partner });
  } catch {
    res.status(404).json({ success: false, error: 'Partner not found' });
  }
});

// POST /api/partners/admin/:id/archive
router.post('/:id/archive', async (req: Request, res: Response) => {
  try {
    const partner = await svc.archive(req.params.id);
    res.json({ success: true, data: partner });
  } catch {
    res.status(404).json({ success: false, error: 'Partner not found' });
  }
});

// DELETE /api/partners/admin/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await svc.deletePartner(req.params.id);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete partner';
    res.status(400).json({ success: false, error: message });
  }
});

// ─── System Settings ────────────────────────────────────────────────────────

// GET /api/partners/admin/settings
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const [settings, platformLlm] = await Promise.all([
      demo.getAllSettings(),
      svc.getPlatformLLMSettings(),
    ]);
    const demoPartners = demo.getDemoPartners();
    res.json({ success: true, data: { settings, demoPartners, platformLlm } });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load settings' });
  }
});

// PUT /api/partners/admin/settings
router.put('/settings', async (req: Request, res: Response) => {
  try {
    const updates = req.body as Record<string, string | undefined>;
    const allowed = ['platform_name', 'auto_approve_partners', 'max_subscriptions_per_partner'];
    for (const [key, value] of Object.entries(updates)) {
      if (allowed.includes(key) && value !== undefined) await demo.setSetting(key, String(value));
    }

    if (updates['platform_llm_provider'] && updates['platform_llm_model']) {
      await svc.updatePlatformLLMSettings({
        provider: updates['platform_llm_provider'],
        endpoint: updates['platform_llm_endpoint'],
        model: updates['platform_llm_model'],
        apiKey: updates['platform_llm_api_key'],
      });
    }

    const [settings, platformLlm] = await Promise.all([
      demo.getAllSettings(),
      svc.getPlatformLLMSettings(),
    ]);
    res.json({ success: true, data: { settings, platformLlm } });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

// POST /api/partners/admin/demo/enable
router.post('/demo/enable', async (_req: Request, res: Response) => {
  try {
    const result = await demo.enableDemo();
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to enable demo';
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/partners/admin/demo/disable
router.post('/demo/disable', async (_req: Request, res: Response) => {
  try {
    const result = await demo.disableDemo();
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to disable demo';
    res.status(500).json({ success: false, error: message });
  }
});

export { router as adminRoutes };
