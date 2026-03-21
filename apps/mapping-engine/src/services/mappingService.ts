import { getPool } from '@bx/database';
import { MessageFormat, MappingRule, PartnerLLMConfig } from '@bx/shared-types';
import { createAIClient } from './aiClient';
import { createLogger } from '@bx/logger';

const logger = createLogger('mapping-engine');
const PARTNER_SERVICE_URL = process.env.PARTNER_SERVICE_URL ?? 'http://localhost:3002';
const PLATFORM_LLM_NOT_CONFIGURED_ERROR = 'Platform default LLM is not configured. Set it in Admin Settings before using AI schema mapping.';

interface TransformInput {
  payload: string;
  sourcePartnerId: string;
  targetPartnerId: string;
  format: MessageFormat;
  stage1Only?: boolean;
  /** Optional BYOLLM config for Stage 1 (source partner's outbound mapping). */
  sourceLlmConfig?: PartnerLLMConfig;
  /** Optional BYOLLM config for Stage 2 (target partner's inbound mapping). */
  targetLlmConfig?: PartnerLLMConfig;
}

interface SchemaInfo {
  id: string;
  format: string;
  messageType: string;
  partnerName: string;
  rules: MappingRule[];
}

export interface LLMStageTrace {
  stage: 1 | 2;
  label: string;       // e.g. "RetailSync JSON → CDM"
  model: string;
  prompt: string;
  response: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LLMContext {
  stages: LLMStageTrace[];
}

// Platform Canonical Data Model — defines the shared intermediate structure.
// Both outbound (source → CDM) and inbound (CDM → target) LLM calls reference
// these fields so the LLM knows what to produce / consume.
const CDM_DEFINITION = `
The CDM (Canonical Data Model) is a flat JSON object with the following structure.
Use exactly these lowercase field names — do NOT invent new top-level groupings.

{
  "id":        "unique document/message identifier",
  "type":      "order | invoice | shipment | payment | remittance | purchase_order | inventory | catalogue",
  "timestamp": "ISO 8601 creation timestamp",

  "sender":   { "id": "", "name": "", "email": "", "address": { "street":"","city":"","state":"","zip":"","country":"" } },
  "receiver": { "id": "", "name": "", "email": "", "address": { "street":"","city":"","state":"","zip":"","country":"" } },

  "order": {
    "id": "", "date": "", "requestedDelivery": "", "status": "",
    "currency": "", "subtotal": 0, "taxAmount": 0, "shippingFee": 0, "total": 0,
    "paymentTerms": "", "notes": "",
    "lineItems": [{ "id":"", "sku":"", "description":"", "quantity":0, "unitPrice":0, "total":0, "unit":"" }]
  },

  "invoice": {
    "id": "", "number": "", "date": "", "dueDate": "",
    "currency": "", "subtotal": 0, "taxRate": 0, "taxAmount": 0, "total": 0,
    "status": "", "paymentTerms": "", "referenceOrderId": ""
  },

  "shipment": {
    "id": "", "date": "", "estimatedDelivery": "", "actualDelivery": "",
    "trackingNumber": "", "carrier": "", "service": "", "status": "",
    "origin":      { "street":"","city":"","state":"","zip":"","country":"" },
    "destination": { "street":"","city":"","state":"","zip":"","country":"" },
    "lineItems": [{ "sku":"", "description":"", "quantity":0, "weight":0, "unit":"" }]
  },

  "payment": {
    "id": "", "date": "", "amount": 0, "currency": "",
    "method": "", "status": "", "referenceInvoiceId": "", "transactionId": ""
  },

  "remittance": {
    "id": "", "date": "", "totalAmount": 0, "currency": "",
    "lineItems": [{ "invoiceId":"", "invoiceDate":"", "paidAmount":0, "status":"" }]
  },

  "inventory": {
    "warehouseId": "", "warehouseName": "", "asOfDate": "",
    "items": [{ "sku":"", "description":"", "quantityOnHand":0, "quantityReserved":0, "reorderPoint":0, "unit":"" }]
  }
}

Omit any top-level key whose data is not present in the source. Always include "id", "type", and "timestamp".
`.trim();

export class MappingService {
  private db = getPool();

  async transform(input: TransformInput): Promise<{
    mappedPayload: string;
    cdmPayload: string;
    rulesApplied: number;
    schemaId?: string;
    outputFormat: MessageFormat;
    llmContext: LLMContext;
  }> {
    const llmContext: LLMContext = { stages: [] };
    const platformLlmConfig = await this.getPlatformLLMConfig();
    const sourceLlmConfig = input.sourceLlmConfig ?? platformLlmConfig ?? undefined;
    const targetLlmConfig = input.targetLlmConfig ?? platformLlmConfig ?? undefined;

    // Load schema info for both partners in parallel
    const [outboundSchema, inboundSchema] = await Promise.all([
      this.getSchemaInfo(input.sourcePartnerId, 'outbound', input.format),
      this.getSchemaInfo(input.targetPartnerId, 'inbound'),
    ]);

    const rulesApplied = (outboundSchema?.rules.length ?? 0) + (inboundSchema?.rules.length ?? 0);

    // No schemas at all — pass through unchanged
    if (rulesApplied === 0) {
      return { mappedPayload: input.payload, cdmPayload: input.payload, rulesApplied: 0, outputFormat: input.format, llmContext };
    }

    // ── Stage 1: source payload → CDM JSON via LLM ───────────────────────────
    const cdmJson = await this.llmToCDM(input.payload, input.format, outboundSchema, llmContext, sourceLlmConfig);

    // ── Stage 2: CDM JSON → target format via LLM ────────────────────────────
    let deliveryPayload: string;
    let outputFormat: MessageFormat;

    if (input.stage1Only) {
      outputFormat = 'json';
      deliveryPayload = cdmJson;
    } else if (!inboundSchema) {
      throw new Error(
        `No active inbound schema for target partner — Stage 2 mapping cannot complete. ` +
        `Register an inbound schema for the target partner before sending messages.`,
      );
    } else {
      outputFormat = inboundSchema.format as MessageFormat;
      deliveryPayload = await this.llmToTarget(cdmJson, inboundSchema, llmContext, targetLlmConfig);
    }

    return {
      mappedPayload: deliveryPayload,
      cdmPayload: cdmJson,
      rulesApplied,
      schemaId: outboundSchema?.id ?? inboundSchema?.id,
      outputFormat,
      llmContext,
    };
  }

  private async getPlatformLLMConfig(): Promise<PartnerLLMConfig | null> {
    try {
      const res = await fetch(`${PARTNER_SERVICE_URL}/api/partners/internal/platform-llm-config`);
      if (!res.ok) return null;
      const body = await res.json() as { success?: boolean; data?: PartnerLLMConfig | null };
      return body.success ? (body.data ?? null) : null;
    } catch {
      return null;
    }
  }

  // ─── Stage 1: Source payload → CDM JSON ─────────────────────────────────────
  private async llmToCDM(payload: string, format: MessageFormat, schema: SchemaInfo | null, llmContext: LLMContext, llmConfig?: PartnerLLMConfig): Promise<string> {
    const formatLabel = this.formatLabel(format);
    const hintsBlock = schema?.rules.length
      ? `\nKnown field mappings for this partner (use as hints):\n` +
        schema.rules.map(r => `  ${r.sourceField}  →  ${r.targetField}${r.transform ? ` (transform: ${r.transform})` : ''}`).join('\n')
      : '';
    const partnerCtx = schema ? `Source partner: ${schema.partnerName} (${schema.messageType} message)` : 'Source partner: unknown';

    const prompt = `You are a B2B data integration expert. Map the following ${formatLabel} message payload into the platform's CDM (Canonical Data Model) JSON format.

${partnerCtx}${hintsBlock}

CDM structure (output must match this JSON shape exactly):
${CDM_DEFINITION}

${formatLabel} Payload:
${payload}

IMPORTANT:
- Output format is ALWAYS a JSON object — never ${formatLabel}, never markdown, never code fences
- Map every meaningful value from the source into the appropriate CDM field
- Use ISO 8601 for all dates and timestamps
- Omit CDM fields that have no corresponding source data`;

    const stageLabel = schema
      ? `${schema.partnerName} ${formatLabel} → CDM`
      : `${formatLabel} → CDM`;
    return this.callLLM(prompt, 'CDM JSON object', 1, stageLabel, llmContext, llmConfig);
  }

  // ─── Stage 2: CDM JSON → target format ──────────────────────────────────────
  private async llmToTarget(cdmJson: string, schema: SchemaInfo, llmContext: LLMContext, llmConfig?: PartnerLLMConfig): Promise<string> {
    const formatLabel = this.formatLabel(schema.format as MessageFormat);
    const hintsBlock = schema.rules.length
      ? `\nKnown field mappings (CDM → partner fields, use as hints):\n` +
        schema.rules.map(r => `  ${r.targetField}  →  ${r.sourceField}${r.transform ? ` (transform: ${r.transform})` : ''}`).join('\n')
      : '';

    const formatInstructions = this.formatInstructions(schema.format as MessageFormat);

    const prompt = `You are a B2B data integration expert. Convert this CDM (Canonical Data Model) JSON into the target partner's expected ${formatLabel} format.

Target partner: ${schema.partnerName} (${schema.messageType} message)${hintsBlock}

${formatInstructions}

CDM Input:
${cdmJson}

Rules:
- Return ONLY the ${formatLabel} payload — no markdown, no code fences, no explanation
- Preserve all values from the CDM; use partner field names from the hints above
- Keep dates in the format expected by this partner's format (ISO for JSON/XML, YYYYMMDD for EDI)`;

    const stageLabel = `CDM → ${schema.partnerName} ${formatLabel}`;
    return this.callLLM(prompt, `${formatLabel} payload`, 2, stageLabel, llmContext, llmConfig);
  }

  // ─── LLM call helper ────────────────────────────────────────────────────────
  private async callLLM(
    prompt: string,
    expectedOutput: string,
    stage: 1 | 2,
    stageLabel: string,
    llmContext: LLMContext,
    llmConfig?: PartnerLLMConfig,
  ): Promise<string> {
    try {
      if (!llmConfig) {
        throw new Error(PLATFORM_LLM_NOT_CONFIGURED_ERROR);
      }
      const client = createAIClient(llmConfig);
      const model  = llmConfig.model;
      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a B2B data integration mapping engine. You output only the requested ${expectedOutput}. Never include markdown formatting, code fences (\`\`\`), or explanations.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        max_completion_tokens: 4096,
      });
      const result       = (response.choices?.[0]?.message?.content ?? '{}').trim();
      const inputTokens  = response.usage?.prompt_tokens     ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      if (!result || result === '{}') {
        throw new Error(`LLM returned empty response at stage ${stage} (${stageLabel})`);
      }
      llmContext.stages.push({ stage, label: stageLabel, model, prompt, response: result, inputTokens, outputTokens });
      return result;
    } catch (err) {
      logger.error({ err }, 'LLM mapping call failed');
      throw err;
    }
  }

  // ─── Schema loader ───────────────────────────────────────────────────────────
  async getSchemaInfo(
    partnerId: string,
    direction: 'outbound' | 'inbound',
    format?: MessageFormat,
  ): Promise<SchemaInfo | null> {
    const { rows } = await this.db.query<{
      id: string;
      format: string;
      message_type: string;
      mapping_rules: MappingRule[];
      partner_name: string;
    }>(
      `SELECT sr.id, sr.format, sr.message_type, sr.mapping_rules, p.name AS partner_name
       FROM schema_registry sr
       JOIN partners p ON p.id = sr.partner_id
       WHERE sr.partner_id = $1
         AND sr.schema_direction = $2
         AND sr.is_active = true
         AND sr.status IN ('auto_approved', 'approved')
         ${format ? 'AND sr.format = $3' : ''}
       ORDER BY sr.version DESC
       LIMIT 1`,
      format ? [partnerId, direction, format] : [partnerId, direction],
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: row.id,
      format: row.format,
      messageType: row.message_type,
      partnerName: row.partner_name,
      rules: row.mapping_rules ?? [],
    };
  }

  /** Fetch active schema rules filtered by partner + direction + optional format */
  async getDirectionalRules(
    partnerId: string,
    direction: 'outbound' | 'inbound',
    format?: MessageFormat,
  ): Promise<{ rules: MappingRule[]; schemaId?: string; format?: string }> {
    const info = await this.getSchemaInfo(partnerId, direction, format);
    return info ? { rules: info.rules, schemaId: info.id, format: info.format } : { rules: [] };
  }

  /** @deprecated Use getDirectionalRules directly */
  async getMappingRulesWithId(
    sourcePartnerId: string,
    targetPartnerId: string,
    messageFormat?: MessageFormat,
  ): Promise<{ rules: MappingRule[]; schemaId?: string; targetPreferredFormat?: MessageFormat }> {
    const [src, tgt] = await Promise.all([
      this.getSchemaInfo(sourcePartnerId, 'outbound', messageFormat),
      this.getSchemaInfo(targetPartnerId, 'inbound', messageFormat),
    ]);
    if (src) return { rules: src.rules, schemaId: src.id, targetPreferredFormat: tgt?.format as MessageFormat };
    if (tgt) return { rules: tgt.rules, schemaId: tgt.id };
    return { rules: [] };
  }

  async getMappingRules(
    sourcePartnerId: string,
    targetPartnerId: string,
    messageFormat?: MessageFormat,
  ): Promise<MappingRule[]> {
    const { rules } = await this.getMappingRulesWithId(sourcePartnerId, targetPartnerId, messageFormat);
    return rules;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  private formatLabel(format: MessageFormat): string {
    const labels: Record<string, string> = {
      json: 'JSON', xml: 'XML', csv: 'CSV', 'edi-x12': 'EDI X12', edifact: 'EDIFACT',
    };
    return labels[format] ?? format.toUpperCase();
  }

  private formatInstructions(format: MessageFormat): string {
    switch (format) {
      case 'xml':
        return 'Output: valid XML with a meaningful root element. Use partner field names as tag names.';
      case 'csv':
        return 'Output: CSV with a header row followed by one data row. Use partner field names as column headers.';
      case 'edi-x12':
        return 'Output: valid EDI X12 document. Use * as element separator and ~ as segment terminator. Include ISA, GS, ST, and appropriate transaction segments.';
      case 'edifact':
        return "Output: valid EDIFACT document. Use + as element separator, : as composite separator, and ' as segment terminator. Include UNB, UNH, and appropriate message segments.";
      default:
        return 'Output: valid JSON object with partner-specific field names.';
    }
  }
}
