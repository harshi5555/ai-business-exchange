import { Router, Request, Response } from 'express';
import { MessageRouter } from '../services/messageRouter';
import { FormatDetector } from '../parsers/formatDetector';
import { ValidationService } from '../services/validationService';
import { getPool } from '@bx/database';

const router = Router();
const messageRouter = new MessageRouter();
const validationService = new ValidationService();

function getViewer(req: Request): { partnerId: string | null; isAdmin: boolean } {
  const partnerIdHeader = req.headers['x-partner-id'];
  const partnerId = typeof partnerIdHeader === 'string' && partnerIdHeader.length > 0
    ? partnerIdHeader
    : null;
  const scopes = (req.headers['x-partner-scopes'] as string ?? '').split(',');

  return { partnerId, isAdmin: scopes.includes('admin') };
}

function requireViewerIdentity(
  res: Response,
  viewer: { partnerId: string | null; isAdmin: boolean },
): boolean {
  if (!viewer.isAdmin && !viewer.partnerId) {
    res.status(401).json({ success: false, error: 'Missing partner identity' });
    return false;
  }

  return true;
}

// POST /api/integrations/messages — inbound message from partner
router.post('/messages', async (req: Request, res: Response) => {
  const sourcePartnerId = req.headers['x-partner-id'] as string;
  const targetPartnerId = req.headers['x-target-partner-id'] as string;

  if (!sourcePartnerId || !targetPartnerId) {
    res.status(400).json({ success: false, error: 'Missing partner IDs' });
    return;
  }

  const contentType = req.headers['content-type'] ?? 'application/json';
  const format = FormatDetector.detect(contentType, req.body as string | object);

  try {
    const messageId = await messageRouter.route({
      sourcePartnerId,
      targetPartnerId,
      format,
      payload: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
    });
    res.status(202).json({ success: true, data: { messageId, status: 'processing' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to route message';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/integrations/messages/stats — message statistics for partner (MUST be before /:id)
router.get('/messages/stats', async (req: Request, res: Response) => {
  const viewer = getViewer(req);
  if (!requireViewerIdentity(res, viewer)) return;
  try {
    const stats = await messageRouter.getStats(viewer.isAdmin ? null : viewer.partnerId);
    res.json({ success: true, data: stats });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get stats';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/integrations/messages/:id — check message status
router.get('/messages/:id', async (req: Request, res: Response) => {
  const viewer = getViewer(req);
  if (!requireViewerIdentity(res, viewer)) return;

  const msg = await messageRouter.getStatus(req.params.id, viewer);
  if (!msg) {
    res.status(404).json({ success: false, error: 'Message not found' });
    return;
  }
  res.json({ success: true, data: msg });
});

// GET /api/integrations/messages — list messages for partner (admin sees all)
router.get('/messages', async (req: Request, res: Response) => {
  const viewer = getViewer(req);
  if (!requireViewerIdentity(res, viewer)) return;
  const { direction, status, format, search, from, to, limit, offset } = req.query as Record<string, string>;
  try {
    const result = await messageRouter.listForPartner(viewer, {
      direction: direction as 'sent' | 'received' | 'all' | undefined,
      status,
      format,
      search,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    res.json({ success: true, data: result.messages, total: result.total });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list messages';
    res.status(500).json({ success: false, error: message });
  }
});

export { router as integrationRoutes };

// ─── Integration Validation (Connection Tests) ──────────────────────────────

// POST /api/integrations/validate — Partner A initiates a validation handshake
router.post('/validate', async (req: Request, res: Response) => {
  const initiatorPartnerId = req.headers['x-partner-id'] as string;
  const { receiverPartnerId, format, payload, notes } = req.body as {
    receiverPartnerId: string;
    format: string;
    payload: string;
    notes?: string;
  };

  if (!initiatorPartnerId || !receiverPartnerId || !format || !payload) {
    res.status(400).json({ success: false, error: 'Missing required fields' });
    return;
  }

  try {
    const test = await validationService.initiate({
      initiatorPartnerId,
      receiverPartnerId,
      format,
      payload,
      notes,
    });
    res.status(201).json({ success: true, data: test });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to initiate validation';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/integrations/validations — list validations for current partner
router.get('/validations', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  const scopes = (req.headers['x-partner-scopes'] as string ?? '').split(',');
  const isAdmin = scopes.includes('admin');
  const { role, status } = req.query as { role?: string; status?: string };

  try {
    const tests = await validationService.list({
      partnerId: isAdmin ? null : partnerId,
      role: role as 'initiator' | 'receiver' | 'all' | undefined,
      status,
    });
    res.json({ success: true, data: tests });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list validations';
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/integrations/validations/:id/confirm — receiver confirms the test
router.post('/validations/:id/confirm', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  const { notes } = req.body as { notes?: string };

  try {
    const test = await validationService.confirm(req.params.id, partnerId, notes);
    if (!test) {
      res.status(404).json({ success: false, error: 'Validation not found or not authorised' });
      return;
    }
    res.json({ success: true, data: test });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to confirm validation';
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/integrations/validations/:id/reject — receiver rejects the test
router.post('/validations/:id/reject', async (req: Request, res: Response) => {
  const partnerId = req.headers['x-partner-id'] as string;
  const { notes } = req.body as { notes?: string };

  try {
    const test = await validationService.reject(req.params.id, partnerId, notes);
    if (!test) {
      res.status(404).json({ success: false, error: 'Validation not found or not authorised' });
      return;
    }
    res.json({ success: true, data: test });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to reject validation';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/integrations/partner-stats/:partnerId — delivery stats for a specific partner pair
router.get('/partner-stats/:partnerId', async (req: Request, res: Response) => {
  const myPartnerId = req.headers['x-partner-id'] as string;
  const { partnerId } = req.params;
  const db = getPool();

  try {
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT
         COUNT(*) FILTER (WHERE source_partner_id = $1 AND target_partner_id = $2)                              AS sent,
         COUNT(*) FILTER (WHERE source_partner_id = $2 AND target_partner_id = $1)                              AS received,
         COUNT(*) FILTER (WHERE source_partner_id = $1 AND target_partner_id = $2 AND status = 'delivered')     AS delivered,
         COUNT(*) FILTER (WHERE source_partner_id = $1 AND target_partner_id = $2 AND status = 'failed')        AS failed,
         COUNT(*) FILTER (WHERE source_partner_id = $1 AND target_partner_id = $2 AND status = 'dead_lettered') AS dead_lettered,
         MAX(updated_at) FILTER (WHERE source_partner_id = $1 AND target_partner_id = $2 AND status = 'delivered') AS last_delivered_at
       FROM messages
       WHERE (source_partner_id = $1 AND target_partner_id = $2)
          OR (source_partner_id = $2 AND target_partner_id = $1)`,
      [myPartnerId, partnerId]
    );
    const row = rows[0] ?? {};
    res.json({
      success: true,
      data: {
        sent:           parseInt((row['sent'] as string) ?? '0'),
        received:       parseInt((row['received'] as string) ?? '0'),
        delivered:      parseInt((row['delivered'] as string) ?? '0'),
        failed:         parseInt((row['failed'] as string) ?? '0'),
        deadLettered:   parseInt((row['dead_lettered'] as string) ?? '0'),
        lastDeliveredAt: row['last_delivered_at'] as string | null,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch partner stats';
    res.status(500).json({ success: false, error: message });
  }
});
