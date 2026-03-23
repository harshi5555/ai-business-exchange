import { getPool } from '@bx/database';
import { generateId } from '@bx/shared-utils';

interface Plan {
  id: string; name: string; description: string;
  base_fee: string; is_active: boolean;
  rates: Rate[];
}
interface Rate {
  id: string; plan_id: string; format: string | null;
  direction: string | null; rate_per_message: string; included_messages: number;
  operation_type: string;
}
interface PartnerBilling {
  partner_id: string; plan_id: string | null; plan_name: string | null;
  custom_base_fee: string | null; billing_email: string | null;
  billing_cycle: string; status: string; trial_ends_at: Date | null;
}
interface UsageRow {
  format: string; direction: string; message_count: number;
}
interface Invoice {
  id: string; period: string; base_fee: string; usage_fee: string;
  total: string; status: string; line_items: object[]; issued_at: Date | null; due_at: Date | null;
}

export class BillingService {
  private db = getPool();

  // ─── Plans ────────────────────────────────────────────────────────────────

  async listPlans(): Promise<Plan[]> {
    const { rows: plans } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM billing_plans ORDER BY base_fee ASC'
    );
    const { rows: rates } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM billing_rates ORDER BY plan_id, format'
    );
    return plans.map(p => ({
      ...(p as unknown as Plan),
      rates: rates.filter(r => r['plan_id'] === p['id']) as unknown as Rate[],
    }));
  }

  async getPlan(id: string): Promise<Plan | null> {
    const plans = await this.listPlans();
    return plans.find(p => p.id === id) ?? null;
  }

  async createPlan(data: { name: string; description: string; base_fee: number; rates: Array<{ format?: string; direction?: string; rate_per_message: number; included_messages: number }> }): Promise<Plan> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const planId = generateId();
      await client.query(
        'INSERT INTO billing_plans (id, name, description, base_fee) VALUES ($1,$2,$3,$4)',
        [planId, data.name, data.description, data.base_fee]
      );
      for (const r of data.rates) {
        await client.query(
          'INSERT INTO billing_rates (id, plan_id, format, direction, rate_per_message, included_messages) VALUES ($1,$2,$3,$4,$5,$6)',
          [generateId(), planId, r.format ?? null, r.direction ?? null, r.rate_per_message, r.included_messages]
        );
      }
      await client.query('COMMIT');
      return (await this.getPlan(planId))!;
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }

  async updatePlan(id: string, data: { name?: string; description?: string; base_fee?: number; is_active?: boolean }): Promise<Plan> {
    const fields: string[] = [];
    const vals: unknown[] = [id];
    if (data.name !== undefined) { vals.push(data.name); fields.push(`name=$${vals.length}`); }
    if (data.description !== undefined) { vals.push(data.description); fields.push(`description=$${vals.length}`); }
    if (data.base_fee !== undefined) { vals.push(data.base_fee); fields.push(`base_fee=$${vals.length}`); }
    if (data.is_active !== undefined) { vals.push(data.is_active); fields.push(`is_active=$${vals.length}`); }
    if (fields.length) {
      await this.db.query(`UPDATE billing_plans SET ${fields.join(',')}, updated_at=NOW() WHERE id=$1`, vals);
    }
    return (await this.getPlan(id))!;
  }

  async upsertRates(planId: string, rates: Array<{ format?: string; direction?: string; rate_per_message: number; included_messages: number; operation_type?: string }>): Promise<void> {
    await this.db.query('DELETE FROM billing_rates WHERE plan_id=$1', [planId]);
    for (const r of rates) {
      await this.db.query(
        'INSERT INTO billing_rates (id,plan_id,format,direction,rate_per_message,included_messages,operation_type) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [generateId(), planId, r.format ?? null, r.direction ?? null, r.rate_per_message, r.included_messages, r.operation_type ?? 'message']
      );
    }
  }

  // ─── Partner Billing Assignment ───────────────────────────────────────────

  async getPartnerBilling(partnerId: string): Promise<PartnerBilling | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT pb.*, bp.name as plan_name FROM partner_billing pb
       LEFT JOIN billing_plans bp ON bp.id = pb.plan_id
       WHERE pb.partner_id = $1`, [partnerId]
    );
    return rows.length ? (rows[0] as unknown as PartnerBilling) : null;
  }

  async assignPlan(partnerId: string, data: { plan_id?: string; custom_base_fee?: number | null; billing_email?: string; billing_cycle?: string; status?: string }): Promise<PartnerBilling> {
    // 'unassigned' is a virtual UI state meaning "no row yet" — default to 'active' on first save
    const status = (!data.status || data.status === 'unassigned') ? 'active' : data.status;
    await this.db.query(
      `INSERT INTO partner_billing (partner_id, plan_id, custom_base_fee, billing_email, billing_cycle, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (partner_id) DO UPDATE SET
         plan_id=$2, custom_base_fee=$3, billing_email=$4,
         billing_cycle=$5, status=$6, updated_at=NOW()`,
      [partnerId, data.plan_id ?? null, data.custom_base_fee ?? null,
       data.billing_email ?? null, data.billing_cycle ?? 'monthly', status]
    );
    return (await this.getPartnerBilling(partnerId))!;
  }

  async listAllPartnerBilling(): Promise<Array<PartnerBilling & { partner_name: string }>> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT
         p.id AS partner_id,
         p.name AS partner_name,
         pb.plan_id,
         bp.name AS plan_name,
         pb.custom_base_fee,
         pb.billing_email,
         COALESCE(pb.billing_cycle, 'monthly') AS billing_cycle,
         COALESCE(pb.status, 'unassigned') AS status,
         pb.trial_ends_at
        FROM partners p
        LEFT JOIN partner_billing pb ON pb.partner_id = p.id
        LEFT JOIN billing_plans bp ON bp.id = pb.plan_id
        WHERE p.status = 'approved'
        ORDER BY p.name`
    );
    return rows as unknown as Array<PartnerBilling & { partner_name: string }>;
  }

  // ─── Usage ────────────────────────────────────────────────────────────────

  async recordUsage(partnerId: string, format: string, direction: 'inbound' | 'outbound', count = 1): Promise<void> {
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM
    await this.db.query(
      `INSERT INTO billing_usage (partner_id, period, format, direction, message_count)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (partner_id, period, format, direction)
       DO UPDATE SET message_count = billing_usage.message_count + $5`,
      [partnerId, period, format, direction, count]
    );
  }

  async getUsage(partnerId: string, period?: string): Promise<{ period: string; rows: UsageRow[]; total: number }> {
    const p = period ?? new Date().toISOString().slice(0, 7);
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT format, direction, message_count FROM billing_usage WHERE partner_id=$1 AND period=$2',
      [partnerId, p]
    );
    const total = (rows as unknown as UsageRow[]).reduce((s, r) => s + r.message_count, 0);
    return { period: p, rows: rows as unknown as UsageRow[], total };
  }

  async getAllUsage(period?: string): Promise<Array<{ partner_id: string; partner_name: string; period: string; total: number; by_format: UsageRow[] }>> {
    const p = period ?? new Date().toISOString().slice(0, 7);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT p.id as partner_id, p.name as partner_name, bu.format, bu.direction, bu.message_count
       FROM billing_usage bu JOIN partners p ON p.id = bu.partner_id
       WHERE bu.period = $1 ORDER BY p.name, bu.format`, [p]
    );
    const byPartner = new Map<string, { partner_id: string; partner_name: string; period: string; total: number; by_format: UsageRow[] }>();
    for (const r of rows as unknown as Array<{ partner_id: string; partner_name: string; format: string; direction: string; message_count: number }>) {
      if (!byPartner.has(r.partner_id)) {
        byPartner.set(r.partner_id, { partner_id: r.partner_id, partner_name: r.partner_name, period: p, total: 0, by_format: [] });
      }
      const entry = byPartner.get(r.partner_id)!;
      entry.by_format.push({ format: r.format, direction: r.direction, message_count: r.message_count });
      entry.total += r.message_count;
    }
    return Array.from(byPartner.values());
  }

  // ─── Invoices ─────────────────────────────────────────────────────────────

  async generateInvoice(partnerId: string, period: string): Promise<Invoice> {
    const billing = await this.getPartnerBilling(partnerId);
    const plan = billing?.plan_id ? await this.getPlan(billing.plan_id) : null;
    const usage = await this.getUsage(partnerId, period);

    const baseFee = billing?.custom_base_fee != null
      ? parseFloat(billing.custom_base_fee)
      : plan ? parseFloat(plan.base_fee) : 0;

    const lineItems: Array<{ format: string; direction: string; count: number; included: number; billable: number; rate: number; amount: number }> = [];
    let usageFee = 0;

    for (const row of usage.rows) {
      const rate = plan?.rates.find(r => (r.format === row.format || r.format === null) && (r.direction === row.direction || r.direction === null));
      const included = rate?.included_messages ?? 0;
      const billable = Math.max(0, row.message_count - included);
      const rateAmt = rate ? parseFloat(rate.rate_per_message) : 0.01;
      const amount = billable * rateAmt;
      usageFee += amount;
      lineItems.push({ format: row.format, direction: row.direction, count: row.message_count, included, billable, rate: rateAmt, amount });
    }

    const total = baseFee + usageFee;
    const invoiceId = generateId();
    const issuedAt = new Date();
    const dueAt = new Date(issuedAt.getTime() + 30 * 24 * 3600 * 1000);

    await this.db.query(
      `INSERT INTO billing_invoices (id, partner_id, period, base_fee, usage_fee, total, status, line_items, issued_at, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,'issued',$7,$8,$9)
       ON CONFLICT DO NOTHING`,
      [invoiceId, partnerId, period, baseFee, usageFee, total, JSON.stringify(lineItems), issuedAt, dueAt]
    );

    return { id: invoiceId, period, base_fee: String(baseFee), usage_fee: String(usageFee), total: String(total), status: 'issued', line_items: lineItems, issued_at: issuedAt, due_at: dueAt };
  }

  /** Records a single LLM mapping call's token usage for billing. */
  async recordLLMUsage(data: {
    partnerId: string; messageId?: string; period: string;
    stage: 1 | 2; llmSource: string; provider: string; model: string;
    inputTokens: number; outputTokens: number;
  }): Promise<void> {
    // Determine billed amount: $0 for external LLM, token-rate-based for platform
    let billedAmount = 0;
    if (data.llmSource === 'platform') {
      const billing = await this.getPartnerBilling(data.partnerId);
      const planId  = billing?.plan_id ?? null;
      if (planId) {
        const { rows } = await this.db.query<{ operation_type: string; rate_per_message: string }>(
          `SELECT operation_type, rate_per_message FROM billing_rates WHERE plan_id = $1
           AND operation_type IN ('llm-input-token', 'llm-output-token')`,
          [planId],
        );
        const inputRate  = parseFloat(rows.find(r => r.operation_type === 'llm-input-token')?.rate_per_message  ?? '0');
        const outputRate = parseFloat(rows.find(r => r.operation_type === 'llm-output-token')?.rate_per_message ?? '0');
        // Rates are per 1,000 tokens
        billedAmount = (data.inputTokens / 1000) * inputRate + (data.outputTokens / 1000) * outputRate;
      }
    }

    await this.db.query(
      `INSERT INTO billing_llm_usage
         (id, partner_id, message_id, period, stage, llm_source, provider, model, input_tokens, output_tokens, billed_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        generateId(), data.partnerId, data.messageId ?? null, data.period,
        data.stage, data.llmSource, data.provider, data.model,
        data.inputTokens, data.outputTokens, billedAmount,
      ],
    );
  }

  /** Returns LLM usage summary for a partner/period. */
  async getLLMUsage(partnerId: string, period?: string): Promise<{
    period: string;
    platformTokens: { input: number; output: number; billedAmount: number };
    externalTokens: { input: number; output: number };
    calls: number;
  }> {
    const p = period ?? new Date().toISOString().slice(0, 7);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT llm_source, SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(billed_amount) AS billed, COUNT(*) AS calls
       FROM billing_llm_usage WHERE partner_id = $1 AND period = $2
       GROUP BY llm_source`,
      [partnerId, p],
    );
    const platform = rows.find(r => r['llm_source'] === 'platform');
    const external = rows.find(r => r['llm_source'] === 'external');
    return {
      period: p,
      platformTokens: {
        input:        parseInt(String(platform?.['input']  ?? 0), 10),
        output:       parseInt(String(platform?.['output'] ?? 0), 10),
        billedAmount: parseFloat(String(platform?.['billed'] ?? 0)),
      },
      externalTokens: {
        input:  parseInt(String(external?.['input']  ?? 0), 10),
        output: parseInt(String(external?.['output'] ?? 0), 10),
      },
      calls: parseInt(String(rows.reduce((s, r) => s + parseInt(String(r['calls']), 10), 0)), 10),
    };
  }

  async getInvoices(partnerId: string): Promise<Invoice[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM billing_invoices WHERE partner_id=$1 ORDER BY period DESC', [partnerId]
    );
    return rows as unknown as Invoice[];
  }

  async getAllInvoices(period?: string): Promise<Array<Invoice & { partner_name: string }>> {
    const where = period ? 'AND bi.period=$1' : '';
    const args = period ? [period] : [];
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT bi.*, p.name as partner_name FROM billing_invoices bi
       JOIN partners p ON p.id=bi.partner_id WHERE 1=1 ${where} ORDER BY bi.period DESC, p.name`, args
    );
    return rows as unknown as Array<Invoice & { partner_name: string }>;
  }

  async markPaid(invoiceId: string): Promise<void> {
    await this.db.query(
      "UPDATE billing_invoices SET status='paid', paid_at=NOW() WHERE id=$1", [invoiceId]
    );
  }
}
