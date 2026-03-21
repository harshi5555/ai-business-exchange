import { Router, Request, Response } from 'express';
import { BillingService } from '../services/billingService';
import { createLogger } from '@bx/logger';

const router = Router();
const svc = new BillingService();
const logger = createLogger('billing-service');

// GET /api/billing/plans — list all plans (public for portal display)
router.get('/plans', async (_req, res: Response) => {
  try {
    const plans = await svc.listPlans();
    res.json({ success: true, data: plans });
  } catch { res.status(500).json({ success: false, error: 'Failed to load plans' }); }
});

// GET /api/billing/my — current partner's billing info
router.get('/my', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  if (!partnerId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }
  try {
    const [billing, plans] = await Promise.all([svc.getPartnerBilling(partnerId), svc.listPlans()]);
    res.json({ success: true, data: { billing, plans } });
  } catch { res.status(500).json({ success: false, error: 'Failed to load billing info' }); }
});

// GET /api/billing/usage?period=YYYY-MM — current partner's usage
router.get('/usage', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  const period = req.query['period'] as string | undefined;
  try {
    const usage = await svc.getUsage(partnerId, period);
    res.json({ success: true, data: usage });
  } catch { res.status(500).json({ success: false, error: 'Failed to load usage' }); }
});

// GET /api/billing/llm-usage?period=YYYY-MM — current partner's LLM token usage
router.get('/llm-usage', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  const period = req.query['period'] as string | undefined;
  try {
    const usage = await svc.getLLMUsage(partnerId, period);
    res.json({ success: true, data: usage });
  } catch { res.status(500).json({ success: false, error: 'Failed to load LLM usage' }); }
});

// POST /api/billing/llm-usage — internal: record LLM call usage (called by integration-service)
router.post('/llm-usage', async (req: Request, res: Response) => {
  try {
    await svc.recordLLMUsage(req.body);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed to record LLM usage' }); }
});

// GET /api/billing/invoices — current partner's invoices
router.get('/invoices', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  try {
    const invoices = await svc.getInvoices(partnerId);
    res.json({ success: true, data: invoices });
  } catch { res.status(500).json({ success: false, error: 'Failed to load invoices' }); }
});

// ─── Admin routes (require admin scope) ─────────────────────────────────────
router.use((req: Request, res: Response, next) => {
  if (!req.path.startsWith('/admin')) return next();
  const scopes = (req.headers['x-partner-scopes'] as string ?? '').split(',');
  if (!scopes.includes('admin')) {
    res.status(403).json({ success: false, error: 'Admin scope required' });
    return;
  }
  next();
});

// GET /api/billing/admin/plans
router.get('/admin/plans', async (_req, res: Response) => {
  try { res.json({ success: true, data: await svc.listPlans() }); }
  catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// POST /api/billing/admin/plans
router.post('/admin/plans', async (req: Request, res: Response) => {
  try {
    const plan = await svc.createPlan(req.body as Parameters<typeof svc.createPlan>[0]);
    res.status(201).json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Failed' });
  }
});

// PUT /api/billing/admin/plans/:id
router.put('/admin/plans/:id', async (req: Request, res: Response) => {
  try {
    const plan = await svc.updatePlan(req.params.id, req.body as Parameters<typeof svc.updatePlan>[1]);
    res.json({ success: true, data: plan });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// PUT /api/billing/admin/plans/:id/rates
router.put('/admin/plans/:id/rates', async (req: Request, res: Response) => {
  try {
    await svc.upsertRates(req.params.id, (req.body as { rates: Parameters<typeof svc.upsertRates>[1] }).rates);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// GET /api/billing/admin/partners — all partners with billing status
router.get('/admin/partners', async (_req, res: Response) => {
  try { res.json({ success: true, data: await svc.listAllPartnerBilling() }); }
  catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// PUT /api/billing/admin/partners/:partnerId — assign plan to partner
router.put('/admin/partners/:partnerId', async (req: Request, res: Response) => {
  try {
    const { partnerId } = req.params;
    if (!partnerId || partnerId === 'null' || partnerId === 'undefined') {
      res.status(400).json({ success: false, error: 'Valid partnerId is required' });
      return;
    }
    const billing = await svc.assignPlan(partnerId, req.body as Parameters<typeof svc.assignPlan>[1]);
    res.json({ success: true, data: billing });
  } catch (err) {
    logger.error({ err }, 'Failed to assign billing plan');
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// GET /api/billing/admin/usage?period=YYYY-MM
router.get('/admin/usage', async (req: Request, res: Response) => {
  try {
    const usage = await svc.getAllUsage(req.query['period'] as string | undefined);
    res.json({ success: true, data: usage });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// GET /api/billing/admin/invoices?period=YYYY-MM
router.get('/admin/invoices', async (req: Request, res: Response) => {
  try {
    const invoices = await svc.getAllInvoices(req.query['period'] as string | undefined);
    res.json({ success: true, data: invoices });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// POST /api/billing/admin/invoices/generate
router.post('/admin/invoices/generate', async (req: Request, res: Response) => {
  const { period, partner_ids } = req.body as { period: string; partner_ids?: string[] };
  try {
    const partners = partner_ids?.length
      ? partner_ids
      : (await svc.listAllPartnerBilling()).map(p => p.partner_id).filter(Boolean);
    const results = await Promise.allSettled(partners.map(id => svc.generateInvoice(id, period)));
    const generated = results.filter(r => r.status === 'fulfilled').length;
    res.json({ success: true, data: { generated, period } });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// PUT /api/billing/admin/invoices/:id/paid
router.put('/admin/invoices/:id/paid', async (req: Request, res: Response) => {
  try { await svc.markPaid(req.params.id); res.json({ success: true }); }
  catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

export { router as billingRoutes };
