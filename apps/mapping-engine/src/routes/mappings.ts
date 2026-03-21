import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { MappingService } from '../services/mappingService';
import { createAIClient } from '../services/aiClient';
import { getPool } from '@bx/database';
import axios from 'axios';

const router = Router();
const svc = new MappingService();
const db = getPool();

const PARTNER_SERVICE_URL = process.env.PARTNER_SERVICE_URL ?? 'http://localhost:3002';

const llmConfigSchema = z.object({
  provider: z.enum(['azure', 'openai', 'openai-compatible']),
  endpoint: z.string().optional(),
  model: z.string(),
  apiKey: z.string(),
});

const transformSchema = z.object({
  payload: z.string(),
  sourcePartnerId: z.string().uuid(),
  targetPartnerId: z.string().uuid(),
  format: z.enum(['json', 'xml', 'csv', 'edi-x12', 'edifact']),
  stage1Only: z.boolean().optional(),
  sourceLlmConfig: llmConfigSchema.optional(),
  targetLlmConfig: llmConfigSchema.optional(),
});

// POST /api/mappings/transform — transform a payload
router.post('/transform', async (req: Request, res: Response) => {
  const parsed = transformSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await svc.transform(parsed.data);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Transformation failed';
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/mappings/test-llm — verify LLM connectivity using the stored config
// scope=platform  → tests the platform-wide default LLM (admin use)
// scope=partner   → tests the calling partner's own LLM config
router.post('/test-llm', async (req: Request, res: Response) => {
  const { scope } = req.body as { scope?: string };
  const partnerId = req.headers['x-partner-id'] as string | undefined;

  try {
type LLMConfigResolved = { provider: string; endpoint?: string; model: string; apiKey: string };

    let llmConfig: LLMConfigResolved | null = null;

    if (scope === 'partner') {
      if (!partnerId) {
        res.status(400).json({ success: false, error: 'Missing partner identity' });
        return;
      }
      const r = await axios.get<{ success: boolean; data: LLMConfigResolved | null }>(
        `${PARTNER_SERVICE_URL}/api/partners/${partnerId}/llm-config`,
        { timeout: 5000 },
      );
      llmConfig = r.data.success ? r.data.data : null;
    } else {
      const r = await axios.get<{ success: boolean; data: LLMConfigResolved | null }>(
        `${PARTNER_SERVICE_URL}/api/partners/internal/platform-llm-config`,
        { timeout: 5000 },
      );
      llmConfig = r.data.success ? r.data.data : null;
    }

    if (!llmConfig?.model || !llmConfig?.apiKey) {
      res.status(400).json({ success: false, error: 'No LLM configuration saved yet — save your settings first.' });
      return;
    }

    const resolved = llmConfig;
    const client = createAIClient(resolved as Parameters<typeof createAIClient>[0]);
    const start = Date.now();
    const response = await (client as import('openai').default).chat.completions.create({
      model: resolved.model,
      messages: [
        { role: 'system', content: 'You are a connectivity test. Respond only with the single word: ok' },
        { role: 'user',   content: 'ping' },
      ],
      max_completion_tokens: 5,
      temperature: 0,
    });
    const latencyMs = Date.now() - start;
    const reply = response.choices?.[0]?.message?.content?.trim() ?? '';

    res.json({ success: true, data: { latencyMs, model: resolved.model, reply } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'LLM test failed';
    res.status(200).json({ success: false, error: message });
  }
});

// GET /api/mappings/capabilities/:partnerId — public capabilities of any partner
router.get('/capabilities/:partnerId', async (req: Request, res: Response) => {
  try {
    const { rows } = await db.query<{ format: string; message_type: string; schema_direction: string }>(
      `SELECT DISTINCT format, message_type, schema_direction
       FROM schema_registry
       WHERE partner_id = $1 AND is_active = true AND status IN ('auto_approved','approved','drift_suspected')
       ORDER BY schema_direction, message_type, format`,
      [req.params.partnerId]
    );

    const outboundFormats  = [...new Set(rows.filter(r => r.schema_direction === 'outbound').map(r => r.format))];
    const inboundFormats   = [...new Set(rows.filter(r => r.schema_direction === 'inbound').map(r => r.format))];
    const outboundTypes    = [...new Set(rows.filter(r => r.schema_direction === 'outbound').map(r => r.message_type))];
    const inboundTypes     = [...new Set(rows.filter(r => r.schema_direction === 'inbound').map(r => r.message_type))];

    res.json({
      success: true,
      data: { outboundFormats, inboundFormats, outboundTypes, inboundTypes },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch capabilities';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/mappings/:sourcePartnerId/:targetPartnerId — get mapping rules
router.get('/:sourcePartnerId/:targetPartnerId', async (req: Request, res: Response) => {
  const rules = await svc.getMappingRules(req.params.sourcePartnerId, req.params.targetPartnerId);
  res.json({ success: true, data: rules });
});

export { router as mappingRoutes };
