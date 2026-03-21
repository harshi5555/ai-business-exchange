import { getPool } from '@bx/database';
import { generateId } from '@bx/shared-utils';
import { Message, MessageFormat, MessageStatus, PartnerLLMConfig } from '@bx/shared-types';
import { WebhookDelivery } from '../delivery/webhookDelivery';
import { createLogger } from '@bx/logger';
import axios from 'axios';

const logger = createLogger('integration-service');

const MAPPING_ENGINE_URL  = process.env.MAPPING_ENGINE_URL  ?? 'http://localhost:3005';
const BILLING_SERVICE_URL = process.env.BILLING_SERVICE_URL ?? 'http://localhost:3007';
const PARTNER_SERVICE_URL = process.env.PARTNER_SERVICE_URL ?? 'http://localhost:3002';

interface RouteInput {
  sourcePartnerId: string;
  targetPartnerId: string;
  format: MessageFormat;
  payload: string;
}

interface MessageRow extends Omit<Message, 'rawPayload'> {
  rawPayload?: string;
  sourcePartnerName?: string;
  targetPartnerName?: string;
  errorMessage?: string;
  schemaId?: string;
  schemaVersion?: number;
  schemaFormat?: string;
  outputFormat?: string;
  cdmPayload?: string;
  llmContext?: Record<string, unknown>;
}

interface ViewerContext {
  partnerId: string | null;
  isAdmin: boolean;
}

export class MessageRouter {
  private db = getPool();
  private delivery = new WebhookDelivery();

  async route(input: RouteInput): Promise<string> {
    // Verify active subscription exists
    const { rows: subs } = await this.db.query(
      `SELECT id FROM subscriptions
       WHERE status = 'active'
         AND ((subscriber_partner_id = $1 AND provider_partner_id = $2)
           OR (subscriber_partner_id = $2 AND provider_partner_id = $1))`,
      [input.targetPartnerId, input.sourcePartnerId]
    );
    if (!subs.length) throw new Error('No active subscription between these partners');

    const messageId = generateId();
    await this.db.query(
      `INSERT INTO messages (id, source_partner_id, target_partner_id, subscription_id, format, raw_payload, status, retries, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'received', 0, NOW(), NOW())`,
      [messageId, input.sourcePartnerId, input.targetPartnerId, subs[0].id, input.format, input.payload]
    );

    // Trigger immediate delivery attempt (async, don't await)
    this.processMessage(messageId, input).catch(() => {});

    return messageId;
  }

  async processMessage(messageId: string, input: RouteInput): Promise<void> {
    try {
      await this.db.query(
        `UPDATE messages SET status = 'processing', updated_at = NOW() WHERE id = $1`,
        [messageId]
      );

      // Step 1: Load per-partner LLM configs (returns null = use platform LLM)
      const [sourceLlmConfig, targetLlmConfig] = await Promise.all([
        this.getPartnerLLMConfig(input.sourcePartnerId),
        this.getPartnerLLMConfig(input.targetPartnerId),
      ]);

      // Step 2: Apply mapping transformation
      let deliveryPayload = input.payload;
      let deliveryFormat = input.format;
      let schemaId: string | undefined;
      try {
        const mapRes = await axios.post<{
          success: boolean;
          data: {
            mappedPayload: string;
            cdmPayload: string;
            rulesApplied: number;
            schemaId?: string;
            outputFormat: string;
            llmContext: { stages: { stage: number; label: string; model: string; prompt: string; response: string; inputTokens: number; outputTokens: number }[] };
          };
        }>(
          `${MAPPING_ENGINE_URL}/api/mappings/transform`,
          {
            payload: input.payload,
            sourcePartnerId: input.sourcePartnerId,
            targetPartnerId: input.targetPartnerId,
            format: input.format,
            ...(sourceLlmConfig && { sourceLlmConfig }),
            ...(targetLlmConfig && { targetLlmConfig }),
          },
          { timeout: 60000 },
        );
        if (!mapRes.data.success || mapRes.data.data.rulesApplied === 0) {
          // No active schema found — reject; all messages must be mapped through CDM
          const reason = 'No active schema mapping found for this partner/format combination — payload cannot be delivered as-is';
          logger.warn({ messageId }, reason);
          await this.db.query(
            `UPDATE messages SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
            [messageId, reason],
          );
          return;
        }

        deliveryPayload = mapRes.data.data.mappedPayload;
        deliveryFormat  = mapRes.data.data.outputFormat as MessageFormat;
        schemaId        = mapRes.data.data.schemaId;
        await this.db.query(
          `UPDATE messages
           SET mapped_payload = $2, cdm_payload = $3, schema_id = $4, output_format = $5,
               llm_context = $6, updated_at = NOW()
           WHERE id = $1`,
          [
            messageId,
            deliveryPayload,
            mapRes.data.data.cdmPayload ?? null,
            schemaId ?? null,
            deliveryFormat,
            JSON.stringify(mapRes.data.data.llmContext ?? {}),
          ],
        );

        // Step 3: Record LLM billing usage asynchronously (non-blocking)
        const period = new Date().toISOString().slice(0, 7); // YYYY-MM
        for (const stg of mapRes.data.data.llmContext?.stages ?? []) {
          const partnerId = stg.stage === 1 ? input.sourcePartnerId : input.targetPartnerId;
          const llmSource = stg.stage === 1
            ? (sourceLlmConfig ? 'external' : 'platform')
            : (targetLlmConfig ? 'external' : 'platform');
          this.recordLLMUsage({
            partnerId, messageId, period,
            stage: stg.stage as 1 | 2,
            llmSource,
            provider: stg.model.includes('azure') ? 'azure' : 'openai',
            model: stg.model,
            inputTokens:  stg.inputTokens  ?? 0,
            outputTokens: stg.outputTokens ?? 0,
          }).catch(() => {}); // best-effort
        }
      } catch (mapErr) {
        // Mapping service unreachable — fail the message; CDM mapping is required
        const mapErrMsg = mapErr instanceof Error ? mapErr.message : 'Mapping service unavailable';
        logger.error({ err: mapErr, messageId, mappingUrl: MAPPING_ENGINE_URL }, 'Mapping call failed');
        await this.db.query(
          `UPDATE messages SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
          [messageId, `Mapping failed: ${mapErrMsg}`],
        );
        return;
      }

      // Step 2: Get target partner webhook URL
      const { rows: partners } = await this.db.query(
        'SELECT webhook_url FROM partners WHERE id = $1 AND status = $2',
        [input.targetPartnerId, 'approved']
      );
      if (!partners.length || !partners[0].webhook_url) {
        await this.db.query(
          `UPDATE messages SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
          [messageId, 'Target partner has no webhook URL configured']
        );
        return;
      }

      // Step 3: Deliver via webhook
      const { delivered, errorMessage } = await this.delivery.deliver({
        messageId,
        webhookUrl: partners[0].webhook_url as string,
        payload: deliveryPayload,
        format: input.format,
        deliveryFormat,
        sourcePartnerId: input.sourcePartnerId,
      });

      await this.db.query(
        `UPDATE messages
         SET status = $2,
             error_message = CASE
               WHEN $3 THEN error_message  -- keep any mapping warning on success
               ELSE $4
             END,
             updated_at = NOW()
         WHERE id = $1`,
        [messageId, delivered ? 'delivered' : 'failed', delivered, delivered ? null : (errorMessage ?? 'Webhook delivery failed after retries')]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected processing error';
      await this.db.query(
        `UPDATE messages SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
        [messageId, msg]
      );
    }
  }

  async getStatus(messageId: string, viewer: ViewerContext): Promise<MessageRow | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT m.*,
              sp.name AS source_partner_name,
              tp.name AS target_partner_name
       FROM messages m
       LEFT JOIN partners sp ON sp.id = m.source_partner_id
       LEFT JOIN partners tp ON tp.id = m.target_partner_id
       WHERE m.id = $1
       LIMIT 1`,
      [messageId]
    );
    if (!rows.length) return null;

    return this.sanitizeMessageForViewer(this.mapRow(rows[0]), viewer);
  }

  async listForPartner(
    viewer: ViewerContext,
    filters: {
      direction?: 'sent' | 'received' | 'all';
      status?: string;
      format?: string;
      search?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ messages: MessageRow[]; total: number }> {
    const { direction = 'all', status, format, search, from, to, limit = 50, offset = 0 } = filters;
    const { partnerId, isAdmin } = viewer;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    // null partnerId = admin — show all messages with no partner filter
    if (!isAdmin && partnerId) {
      params.push(partnerId);
      if (direction === 'sent') {
        conditions.push(`source_partner_id = $${p++}`);
      } else if (direction === 'received') {
        conditions.push(`target_partner_id = $${p++}`);
      } else {
        conditions.push(`(source_partner_id = $${p} OR target_partner_id = $${p})`);
        p++;
      }
    }

    if (status) { conditions.push(`m.status = $${p++}`); params.push(status); }
    if (format) { conditions.push(`m.format = $${p++}`); params.push(format); }
    if (search) { conditions.push(`m.raw_payload ILIKE $${p++}`); params.push(`%${search}%`); }
    if (from) { conditions.push(`m.created_at >= $${p++}`); params.push(from); }
    if (to) { conditions.push(`m.created_at <= $${p++}`); params.push(to); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM messages m ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT m.*,
              sp.name AS source_partner_name,
              tp.name AS target_partner_name
       FROM messages m
       LEFT JOIN partners sp ON sp.id = m.source_partner_id
       LEFT JOIN partners tp ON tp.id = m.target_partner_id
       ${where}
       ORDER BY m.created_at DESC LIMIT $${p++} OFFSET $${p}`,
       [...params, limit, offset]
     );

    const messages = rows
      .map((r) => this.sanitizeMessageForViewer(this.mapRow(r), viewer))
      .filter((message): message is MessageRow => message !== null);

    return { messages, total };
  }

  async getStats(partnerId: string | null): Promise<{
    byStatus: Record<string, number>;
    byFormat: Record<string, number>;
    dailyVolume: { date: string; sent: number; received: number }[];
  }> {
    const partnerFilter = partnerId
      ? 'WHERE source_partner_id = $1 OR target_partner_id = $1'
      : '';
    const params = partnerId ? [partnerId] : [];

    const sentCol = partnerId ? `COUNT(*) FILTER (WHERE source_partner_id = $1)` : `COUNT(*) FILTER (WHERE true)`;
    const recvCol = partnerId ? `COUNT(*) FILTER (WHERE target_partner_id = $1)` : `COUNT(*) FILTER (WHERE true)`;
    const dailyFilter = partnerId
      ? `WHERE (source_partner_id = $1 OR target_partner_id = $1) AND created_at >= NOW() - INTERVAL '14 days'`
      : `WHERE created_at >= NOW() - INTERVAL '14 days'`;

    const [statusResult, formatResult, dailyResult] = await Promise.all([
      this.db.query<{ status: string; count: string }>(
        `SELECT status, COUNT(*) AS count FROM messages ${partnerFilter} GROUP BY status`,
        params
      ),
      this.db.query<{ format: string; count: string }>(
        `SELECT format, COUNT(*) AS count FROM messages ${partnerFilter} GROUP BY format`,
        params
      ),
      this.db.query<{ day: string; sent: string; received: string }>(
        `SELECT
           DATE(created_at) AS day,
           ${sentCol} AS sent,
           ${recvCol} AS received
         FROM messages
         ${dailyFilter}
         GROUP BY DATE(created_at)
         ORDER BY day ASC`,
        params
      ),
    ]);

    const byStatus: Record<string, number> = {};
    for (const r of statusResult.rows) byStatus[r.status] = parseInt(r.count, 10);

    const byFormat: Record<string, number> = {};
    for (const r of formatResult.rows) byFormat[r.format] = parseInt(r.count, 10);

    const dailyVolume = dailyResult.rows.map((r) => ({
      date: r.day,
      sent: parseInt(r.sent, 10),
      received: parseInt(r.received, 10),
    }));

    return { byStatus, byFormat, dailyVolume };
  }

  private async updateStatus(messageId: string, status: MessageStatus): Promise<void> {
    await this.db.query(
      'UPDATE messages SET status = $2, updated_at = NOW() WHERE id = $1',
      [messageId, status]
    );
  }

  private mapRow(row: Record<string, unknown>): MessageRow {
    return {
      id: row['id'] as string,
      sourcePartnerId: row['source_partner_id'] as string,
      targetPartnerId: row['target_partner_id'] as string,
      subscriptionId: row['subscription_id'] as string,
      format: row['format'] as MessageFormat,
      rawPayload: row['raw_payload'] as string,
      mappedPayload: row['mapped_payload'] as string | undefined,
      cdmPayload: row['cdm_payload'] as string | undefined,
      llmContext: row['llm_context'] as Record<string, unknown> | undefined,
      status: row['status'] as MessageStatus,
      retries: row['retries'] as number,
      createdAt: row['created_at'] as Date,
      updatedAt: row['updated_at'] as Date,
      sourcePartnerName: row['source_partner_name'] as string | undefined,
      targetPartnerName: row['target_partner_name'] as string | undefined,
      errorMessage: row['error_message'] as string | undefined,
      schemaId: row['schema_id'] as string | undefined,
      schemaVersion: row['schema_version'] as number | undefined,
      schemaFormat: row['schema_format'] as string | undefined,
      outputFormat: row['output_format'] as string | undefined,
    };
  }

  private sanitizeMessageForViewer(message: MessageRow, viewer: ViewerContext): MessageRow | null {
    if (viewer.isAdmin) return message;
    if (!viewer.partnerId) return null;

    const isSender = message.sourcePartnerId === viewer.partnerId;
    const isReceiver = message.targetPartnerId === viewer.partnerId;

    if (!isSender && !isReceiver) return null;

    if (isSender) {
      return {
        ...message,
        mappedPayload: undefined,
        // outputFormat (e.g. "json") is the receiver's wire format label — not sensitive
        llmContext: this.filterLLMContext(message.llmContext, 1),
      };
    }

    return {
      ...message,
      rawPayload: undefined,
      llmContext: this.filterLLMContext(message.llmContext, 2),
    };
  }

  private filterLLMContext(
    llmContext: Record<string, unknown> | undefined,
    visibleStage: 1 | 2,
  ): Record<string, unknown> | undefined {
    const stagesValue = llmContext?.['stages'];
    if (!Array.isArray(stagesValue)) return undefined;

    const stages = stagesValue.filter((stage): stage is Record<string, unknown> => {
      return typeof stage === 'object' && stage !== null && stage['stage'] === visibleStage;
    });

    return stages.length > 0 ? { ...llmContext, stages } : undefined;
  }

  /** Fetches a partner's decrypted LLM config via the partner-service internal API.
   *  Returns null if the partner uses the platform LLM (default). */
  private async getPartnerLLMConfig(partnerId: string): Promise<PartnerLLMConfig | null> {
    try {
      const res = await axios.get<{ success: boolean; data: PartnerLLMConfig | null }>(
        `${PARTNER_SERVICE_URL}/api/partners/${partnerId}/llm-config`,
        { timeout: 5000 },
      );
      return res.data.success ? res.data.data : null;
    } catch {
      return null; // fall back to platform LLM silently
    }
  }

  /** Records LLM usage to the billing service (best-effort, non-blocking). */
  private async recordLLMUsage(usage: {
    partnerId: string; messageId: string; period: string;
    stage: 1 | 2; llmSource: string; provider: string; model: string;
    inputTokens: number; outputTokens: number;
  }): Promise<void> {
    await axios.post(
      `${BILLING_SERVICE_URL}/api/billing/llm-usage`,
      usage,
      { timeout: 5000 },
    );
  }
}
