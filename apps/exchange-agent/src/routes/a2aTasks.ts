import { Router, Response } from 'express';
import { z } from 'zod';
import { generateId } from '@bx/shared-utils';
import { createLogger } from '@bx/logger';
import type { Task, SendTaskRequest } from '@bx/a2a-sdk';
import { apiKeyMiddleware, AuthenticatedRequest } from '../middleware/apiKey';
import { SessionStore } from '../services/sessionStore';
import { NegotiationEngine } from '../services/negotiationEngine';

const router = Router();
const logger = createLogger('exchange-agent:a2a');
const store = new SessionStore();
const engine = new NegotiationEngine();

// GET /a2a/sessions — list all sessions (portal/JWT path, no API key needed)
router.get('/sessions', async (req: AuthenticatedRequest, res: Response) => {
  const page = parseInt(String(req.query.page ?? 1));
  const pageSize = parseInt(String(req.query.pageSize ?? 20));
  const { sessions, total } = await store.listAll(pageSize, (page - 1) * pageSize);
  res.json({ success: true, data: sessions, total, page, pageSize });
});

router.use(apiKeyMiddleware);

const sendTaskSchema = z.object({
  id: z.string().optional(),
  skill: z.string().optional(),
  message: z.object({
    role: z.enum(['user', 'agent']).default('user'),
    parts: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
      data: z.record(z.unknown()).optional(),
    })),
  }),
});

function extractText(req: SendTaskRequest): string {
  return req.message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('\n');
}

function sessionToTask(session: ReturnType<SessionStore['findById']> extends Promise<infer T> ? NonNullable<T> : never): Task {
  const stateMap: Record<string, Task['status']['state']> = {
    discovery:        'working',
    schema_submitted: 'working',
    mapping_proposed: 'input-required',
    counter_offered:  'input-required',
    terms_negotiated: 'input-required',
    provisioning:     'working',
    active:           'completed',
    failed:           'failed',
    abandoned:        'canceled',
  };
  const lastAgentMsg = [...session.negotiationContext].reverse().find((m) => m.role === 'agent');
  return {
    id: session.a2aTaskId ?? session.id,
    status: {
      state: stateMap[session.state] ?? 'working',
      message: lastAgentMsg
        ? { role: 'agent', parts: [{ type: 'text', text: lastAgentMsg.content }] }
        : undefined,
      timestamp: session.updatedAt.toISOString(),
    },
    history: session.negotiationContext.map((m) => ({
      role: m.role,
      parts: [{ type: 'text', text: m.content }],
    })),
    metadata: { sessionId: session.id, state: session.state },
  };
}

// POST /a2a/tasks — create a new negotiation task
router.post('/tasks', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = sendTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ id: null, error: { code: 400, message: 'Invalid request', data: parsed.error.flatten() } });
    return;
  }
  const taskId = parsed.data.id ?? generateId();
  try {
    const session = await store.create(taskId, req.partnerId);
    const userText = extractText(parsed.data as SendTaskRequest);
    const { session: updated } = await engine.handleUserMessage(session, userText || 'Hello, I would like to integrate with the platform.');
    logger.info({ taskId, sessionId: session.id }, 'A2A task created');
    res.status(202).json({ id: taskId, result: sessionToTask({ ...updated, a2aTaskId: taskId }) });
  } catch (err) {
    logger.error({ err, taskId }, 'Error creating task');
    res.status(500).json({ id: taskId, error: { code: 500, message: 'Internal error' } });
  }
});

// GET /a2a/tasks/:taskId — poll task status
router.get('/tasks/:taskId', async (req: AuthenticatedRequest, res: Response) => {
  const { taskId } = req.params;
  const session = await store.findByTaskId(taskId);
  if (!session) {
    res.status(404).json({ id: taskId, error: { code: 404, message: 'Task not found' } });
    return;
  }
  res.json({ id: taskId, result: sessionToTask(session) });
});

// POST /a2a/tasks/:taskId/send — continue a negotiation
router.post('/tasks/:taskId/send', async (req: AuthenticatedRequest, res: Response) => {
  const { taskId } = req.params;
  const session = await store.findByTaskId(taskId);
  if (!session) {
    res.status(404).json({ id: taskId, error: { code: 404, message: 'Task not found' } });
    return;
  }
  if (session.state === 'active' || session.state === 'failed' || session.state === 'abandoned') {
    res.status(409).json({ id: taskId, error: { code: 409, message: `Task is already ${session.state}` } });
    return;
  }

  const parsed = sendTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ id: taskId, error: { code: 400, message: 'Invalid request' } });
    return;
  }
  const userText = extractText(parsed.data as SendTaskRequest);
  const { session: updated } = await engine.handleUserMessage(session, userText);
  res.json({ id: taskId, result: sessionToTask(updated) });
});

export { router as a2aTasksRouter };
