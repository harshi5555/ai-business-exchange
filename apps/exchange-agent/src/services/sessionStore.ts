import { getPool } from '@bx/database';
import { generateId } from '@bx/shared-utils';

export type SessionState =
  | 'discovery'
  | 'schema_submitted'
  | 'mapping_proposed'
  | 'counter_offered'
  | 'terms_negotiated'
  | 'provisioning'
  | 'active'
  | 'failed'
  | 'abandoned';

export interface AgentSession {
  id: string;
  partnerId?: string;
  a2aTaskId?: string;
  state: SessionState;
  negotiationContext: NegotiationMessage[];
  proposedMapping?: unknown;
  proposedSubscriptions?: unknown;
  partnerName?: string;
  partnerDomain?: string;
  partnerEmail?: string;
  webhookUrl?: string;
  samplePayload?: string;
  supportedFormats: string[];
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface NegotiationMessage {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export class SessionStore {
  private db = getPool();

  async create(taskId: string, partnerId?: string): Promise<AgentSession> {
    const id = generateId();
    const { rows } = await this.db.query<AgentSession>(
      `INSERT INTO agent_sessions (id, a2a_task_id, state, partner_id)
       VALUES ($1, $2, 'discovery', $3)
       RETURNING *`,
      [id, taskId, partnerId ?? null],
    );
    return this.mapRow(rows[0]);
  }

  async findByTaskId(taskId: string): Promise<AgentSession | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM agent_sessions WHERE a2a_task_id = $1 LIMIT 1`,
      [taskId],
    );
    return rows.length ? this.mapRow(rows[0]) : null;
  }

  async findById(id: string): Promise<AgentSession | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM agent_sessions WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows.length ? this.mapRow(rows[0]) : null;
  }

  async update(id: string, patch: Partial<AgentSession>): Promise<AgentSession> {
    const sets: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let idx = 1;

    const addField = (col: string, val: unknown) => {
      sets.push(`${col} = $${idx++}`);
      values.push(val);
    };

    if (patch.state !== undefined)               addField('state', patch.state);
    if (patch.partnerId !== undefined)           addField('partner_id', patch.partnerId);
    if (patch.negotiationContext !== undefined)  addField('negotiation_context', JSON.stringify(patch.negotiationContext));
    if (patch.proposedMapping !== undefined)     addField('proposed_mapping', JSON.stringify(patch.proposedMapping));
    if (patch.proposedSubscriptions !== undefined) addField('proposed_subscriptions', JSON.stringify(patch.proposedSubscriptions));
    if (patch.partnerName !== undefined)         addField('partner_name', patch.partnerName);
    if (patch.partnerDomain !== undefined)       addField('partner_domain', patch.partnerDomain);
    if (patch.partnerEmail !== undefined)        addField('partner_email', patch.partnerEmail);
    if (patch.webhookUrl !== undefined)          addField('webhook_url', patch.webhookUrl);
    if (patch.samplePayload !== undefined)       addField('sample_payload', patch.samplePayload);
    if (patch.supportedFormats !== undefined)    addField('supported_formats', patch.supportedFormats);
    if (patch.errorMessage !== undefined)        addField('error_message', patch.errorMessage);
    if (patch.completedAt !== undefined)         addField('completed_at', patch.completedAt);

    values.push(id);
    const { rows } = await this.db.query(
      `UPDATE agent_sessions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return this.mapRow(rows[0]);
  }

  async listAll(limit = 50, offset = 0): Promise<{ sessions: AgentSession[]; total: number }> {
    const [{ rows }, { rows: countRows }] = await Promise.all([
      this.db.query(
        `SELECT * FROM agent_sessions ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.db.query(`SELECT COUNT(*) AS count FROM agent_sessions`),
    ]);
    return {
      sessions: rows.map((r) => this.mapRow(r)),
      total: parseInt(countRows[0].count as string, 10),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapRow(row: any): AgentSession {
    return {
      id: row.id,
      partnerId: row.partner_id ?? undefined,
      a2aTaskId: row.a2a_task_id ?? undefined,
      state: row.state,
      negotiationContext: typeof row.negotiation_context === 'string'
        ? JSON.parse(row.negotiation_context)
        : (row.negotiation_context ?? []),
      proposedMapping: row.proposed_mapping ?? undefined,
      proposedSubscriptions: row.proposed_subscriptions ?? undefined,
      partnerName: row.partner_name ?? undefined,
      partnerDomain: row.partner_domain ?? undefined,
      partnerEmail: row.partner_email ?? undefined,
      webhookUrl: row.webhook_url ?? undefined,
      samplePayload: row.sample_payload ?? undefined,
      supportedFormats: row.supported_formats ?? [],
      errorMessage: row.error_message ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
    };
  }
}
