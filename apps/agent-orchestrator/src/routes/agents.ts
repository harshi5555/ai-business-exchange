import { Router, Request, Response } from 'express';
import { getPool } from '@bx/database';
import { MonitoringService } from '../services/monitoringService';

const router = Router();
const db = getPool();
const monitoringService = new MonitoringService();

// GET /api/agents/overview — runtime, health, topology, and pipeline overview
router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const overview = await monitoringService.getOverview();
    res.json({ success: true, data: overview });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load overview';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/agents/events — recent agent events
router.get('/events', async (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query['limit'] as string) ?? '50');
    const { rows } = await db.query(
      'SELECT * FROM agent_events ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    res.json({ success: true, data: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load agent events';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/agents/events/:entityId — events for a specific entity
router.get('/events/:entityId', async (req: Request, res: Response) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM agent_events WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.params.entityId]
    );
    res.json({ success: true, data: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load agent events';
    res.status(500).json({ success: false, error: message });
  }
});

export { router as agentRoutes };
