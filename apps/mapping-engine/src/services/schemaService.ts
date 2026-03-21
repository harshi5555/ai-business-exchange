import { createAIClient } from './aiClient';
import { getPool } from '@bx/database';
import { generateId } from '@bx/shared-utils';
import { MessageFormat, MappingRule, PartnerLLMConfig, SchemaRegistration, SchemaDirection } from '@bx/shared-types';

const PARTNER_SERVICE_URL = process.env.PARTNER_SERVICE_URL ?? 'http://localhost:3002';
const PLATFORM_LLM_NOT_CONFIGURED_ERROR = 'Platform default LLM is not configured. Set it in Admin Settings before using AI schema mapping.';

function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

interface RegisterInput {
  format: MessageFormat;
  messageType: string;
  samplePayload: string;
  sampleSchema?: string;   // optional: JSON Schema / XSD / CSV headers / EDI spec
  direction?: SchemaDirection;
  description?: string;
}

// Canonical Data Model fields (platform standard)
const CDM_FIELDS = [
  'id', 'type', 'timestamp',
  'sender.id', 'sender.name', 'sender.email',
  'receiver.id', 'receiver.name',
  'order.id', 'order.date', 'order.total', 'order.currency',
  'order.lineItems[].id', 'order.lineItems[].sku', 'order.lineItems[].quantity', 'order.lineItems[].price',
  'invoice.id', 'invoice.date', 'invoice.dueDate', 'invoice.amount',
  'shipment.id', 'shipment.trackingNumber', 'shipment.carrier', 'shipment.status',
  'product.id', 'product.sku', 'product.name', 'product.price',
  'address.street', 'address.city', 'address.state', 'address.zip', 'address.country',
];

export class SchemaService {
  private db = getPool();

  async register(partnerId: string, input: RegisterInput): Promise<SchemaRegistration> {
    const id = generateId();
    const direction: SchemaDirection = input.direction ?? 'outbound';
    const llmConfig = (await this.getPartnerLLMConfig(partnerId)) ?? (await this.getPlatformLLMConfig());
    if (!llmConfig) {
      throw new Error(PLATFORM_LLM_NOT_CONFIGURED_ERROR);
    }
    const model = llmConfig.model;

    // Auto-increment version per (partner_id, direction, format, message_type)
    const { rows: versionRows } = await this.db.query<{ max: number }>(
      'SELECT COALESCE(MAX(version), 0) AS max FROM schema_registry WHERE partner_id = $1 AND schema_direction = $2 AND format = $3 AND message_type = $4',
      [partnerId, direction, input.format, input.messageType]
    );
    const nextVersion = (versionRows[0]?.max ?? 0) + 1;
    const isActive = nextVersion === 1;

    const { inferredSchema, mappingRules } = await this.inferWithAI(input.samplePayload, input.format, direction, input.sampleSchema, llmConfig);
    const status = mappingRules.every((r) => r.confidence >= 0.85) ? 'auto_approved' : 'pending_review';

    const { rows } = await this.db.query<Record<string, unknown>>(
      `INSERT INTO schema_registry (id, partner_id, format, message_type, schema_direction, sample_payload, inferred_schema, mapping_rules, version, status, is_active, created_with_model, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()) RETURNING *`,
      [id, partnerId, input.format, input.messageType, direction, input.samplePayload, JSON.stringify(inferredSchema), JSON.stringify(mappingRules), nextVersion, status, isActive, model]
    );
    return this.mapRow(rows[0]);
  }

  async listForPartner(partnerId: string): Promise<SchemaRegistration[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM schema_registry WHERE partner_id = $1 ORDER BY format ASC, version DESC',
      [partnerId]
    );
    return rows.map((r) => this.mapRow(r));
  }

  async approveMapping(id: string): Promise<SchemaRegistration> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `UPDATE schema_registry SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length) throw new Error('Schema not found');
    return this.mapRow(rows[0]);
  }

  async activateSchema(id: string): Promise<SchemaRegistration> {
    // Fetch the target schema to get partner_id + format + message_type
    const { rows: target } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM schema_registry WHERE id = $1',
      [id]
    );
    if (!target.length) throw new Error('Schema not found');
    const { partner_id, format, message_type, schema_direction } = target[0] as { partner_id: string; format: string; message_type: string; schema_direction: string };

    // Deactivate all versions for this partner+direction+format+message_type, then activate the chosen one
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE schema_registry SET is_active = false WHERE partner_id = $1 AND schema_direction = $2 AND format = $3 AND message_type = $4',
        [partner_id, schema_direction, format, message_type]
      );
      const { rows } = await client.query<Record<string, unknown>>(
        'UPDATE schema_registry SET is_active = true, updated_at = NOW() WHERE id = $1 RETURNING *',
        [id]
      );
      await client.query('COMMIT');
      return this.mapRow(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteSchema(id: string): Promise<void> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM schema_registry WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new Error('Schema not found');

    const schema = rows[0];
    if (schema['is_active']) {
      // Check if there are other versions for this partner+format+message_type
      const { rows: others } = await this.db.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM schema_registry WHERE partner_id = $1 AND format = $2 AND message_type = $3 AND id != $4',
        [schema['partner_id'], schema['format'], schema['message_type'], id]
      );
      if (parseInt(others[0]?.count ?? '0') > 0) {
        throw new Error('Cannot delete the active version while other versions exist. Activate another version first.');
      }
    }

    await this.db.query('DELETE FROM schema_registry WHERE id = $1', [id]);
  }

  async updateRules(id: string, mappingRules: MappingRule[]): Promise<SchemaRegistration> {
    const newStatus = mappingRules.every((r) => r.confidence >= 0.85) ? 'auto_approved' : 'pending_review';
    const { rows } = await this.db.query<Record<string, unknown>>(
      `UPDATE schema_registry SET mapping_rules = $1, status = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [JSON.stringify(mappingRules), newStatus, id]
    );
    if (!rows.length) throw new Error('Schema not found');
    return this.mapRow(rows[0]);
  }

  private async inferWithAI(
    samplePayload: string,
    format: MessageFormat,
    direction: SchemaDirection = 'outbound',
    sampleSchema?: string,
    llmConfig?: PartnerLLMConfig,
  ): Promise<{ inferredSchema: Record<string, unknown>; mappingRules: MappingRule[] }> {
    const schemaSection = sampleSchema
      ? `\nSchema definition (${format.toUpperCase()} schema / XSD / JSON Schema / CSV headers — use this to understand field names and types precisely):\n${sampleSchema.slice(0, 2000)}\n`
      : '';
    const xmlNote = format === 'xml'
      ? `\nIMPORTANT for XML: The payload will be parsed with namespace prefixes stripped (e.g. cbc:ID becomes ID, cac:Party becomes Party).
Write sourceField paths using the stripped names, starting from the root element name (e.g. "Order.BuyerCustomerParty.Party.EndpointID").
Use JSONata dot-notation only. Do NOT use namespace prefixes like cbc: or cac: in paths.
For elements that have both attributes AND text content (e.g. <PriceAmount currencyID="SEK">1499.00</PriceAmount>),
the text value is accessed via .value (e.g. "Order.OrderLine.Price.PriceAmount.value") and attributes by their plain name (e.g. "Order.OrderLine.Price.PriceAmount.currencyID").`
      : '';

    const isInbound = direction === 'inbound';

    const prompt = isInbound
      ? `You are a data integration expert defining an INBOUND mapping schema.
The receiver wants to accept messages in CDM (Canonical Data Model) format and transform them into their own internal format shown in the sample below.

CDM source fields available: ${CDM_FIELDS.join(', ')}
${schemaSection}
Sample of the receiver's OWN format (this is what the output should look like):
${samplePayload.slice(0, 3000)}

Map each CDM source field to the closest field in the receiver's sample format.
sourceField = CDM path (e.g. "invoice.id")
targetField = receiver's own field name (e.g. "InvNum")

Respond with valid JSON only:
{
  "inferredSchema": { ... JSON Schema of the receiver's format ... },
  "mappingRules": [
    { "sourceField": "cdm.field", "targetField": "receiverField", "confidence": 0.95, "transform": "optional JS expression" }
  ]
}`
      : `You are a data integration expert. Analyze this ${format.toUpperCase()} payload and:
1. Infer its JSON schema structure
2. Map each field to the closest Canonical Data Model (CDM) field

CDM fields available: ${CDM_FIELDS.join(', ')}
${schemaSection}${xmlNote}
Sample payload:
${samplePayload.slice(0, 3000)}

Respond with valid JSON only:
{
  "inferredSchema": { ... JSON Schema ... },
  "mappingRules": [
    { "sourceField": "fieldPath", "targetField": "cdm.field", "confidence": 0.95, "transform": "optional JS expression" }
  ]
}`;

    if (!llmConfig) {
      throw new Error(PLATFORM_LLM_NOT_CONFIGURED_ERROR);
    }

    const client = createAIClient(llmConfig);
    const model = llmConfig.model;
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });

    const result = JSON.parse(extractJsonObject(completion.choices[0].message.content ?? '{}')) as {
      inferredSchema?: Record<string, unknown>;
      mappingRules?: MappingRule[];
    };

    if (!Array.isArray(result.mappingRules) || result.mappingRules.length === 0) {
      throw new Error('AI mapping returned no rules. Verify the platform LLM configuration and try a richer sample payload.');
    }

    return {
      inferredSchema: result.inferredSchema ?? {},
      mappingRules: result.mappingRules,
    };
  }

  private mapRow(row: Record<string, unknown>): SchemaRegistration {
    return {
      id: row['id'] as string,
      partnerId: row['partner_id'] as string,
      format: row['format'] as MessageFormat,
      messageType: (row['message_type'] as string) ?? 'custom',
      schemaDirection: (row['schema_direction'] as SchemaDirection) ?? 'outbound',
      createdWithModel: row['created_with_model'] as string | undefined,
      samplePayload: row['sample_payload'] as string,
      inferredSchema: row['inferred_schema'] as Record<string, unknown>,
      mappingRules: row['mapping_rules'] as MappingRule[],
      version: row['version'] as number,
      status: row['status'] as string,
      isActive: row['is_active'] as boolean,
      createdAt: row['created_at'] as Date,
    };
  }

  async listActiveForPartner(partnerId: string): Promise<SchemaRegistration[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM schema_registry WHERE partner_id = $1 AND is_active = true ORDER BY message_type ASC, format ASC',
      [partnerId]
    );
    return rows.map((r) => this.mapRow(r));
  }

  private async getPartnerLLMConfig(partnerId: string): Promise<PartnerLLMConfig | null> {
    try {
      const res = await fetch(`${PARTNER_SERVICE_URL}/api/partners/${partnerId}/llm-config`);
      if (!res.ok) return null;
      const body = await res.json() as { success?: boolean; data?: PartnerLLMConfig | null };
      return body.success ? (body.data ?? null) : null;
    } catch {
      return null;
    }
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
}
