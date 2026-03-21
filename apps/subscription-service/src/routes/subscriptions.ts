import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { SubscriptionService } from '../services/subscriptionService';

const router = Router();
const svc = new SubscriptionService();

const createSchema = z.object({
  providerPartnerId: z.string().uuid(),
});

// GET /api/subscriptions/send-targets — active subscribers of the current partner (for send form)
router.get('/send-targets', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  try {
    const targets = await svc.listSendTargets(partnerId);
    res.json({ success: true, data: targets });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list targets';
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/subscriptions — subscribe to a partner
router.post('/', async (req: Request, res: Response) => {
  const subscriberId = req.headers['x-partner-id'] as string;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }
  if (parsed.data.providerPartnerId === subscriberId) {
    res.status(400).json({ success: false, error: 'Cannot subscribe to yourself' });
    return;
  }
  try {
    const sub = await svc.create(subscriberId, parsed.data.providerPartnerId);
    res.status(201).json({ success: true, data: sub });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create subscription';
    res.status(409).json({ success: false, error: message });
  }
});

// GET /api/subscriptions — list my subscriptions
router.get('/', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  const subs = await svc.listForPartner(partnerId);
  res.json({ success: true, data: subs });
});

// POST /api/subscriptions/:id/approve — provider approves
router.post('/:id/approve', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  try {
    const sub = await svc.approve(req.params.id, partnerId);
    res.json({ success: true, data: sub });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to approve';
    res.status(403).json({ success: false, error: message });
  }
});

// POST /api/subscriptions/:id/terminate
router.post('/:id/terminate', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  try {
    await svc.terminate(req.params.id, partnerId);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to terminate';
    res.status(403).json({ success: false, error: message });
  }
});

export { router as subscriptionRoutes };
