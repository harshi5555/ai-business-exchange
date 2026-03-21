import { getPool } from '@bx/database';
import { MessageRouter } from './messageRouter';

export interface ConnectionTest {
  id: string;
  subscriptionId: string;
  initiatorPartnerId: string;
  receiverPartnerId: string;
  initiatorPartnerName: string;
  receiverPartnerName: string;
  format: string;
  testPayload: string;
  messageId: string | null;
  status: 'pending' | 'delivered' | 'confirmed' | 'rejected' | 'expired';
  initiatorNotes: string | null;
  receiverNotes: string | null;
  confirmedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export class ValidationService {
  private db = getPool();
  private messageRouter = new MessageRouter();

  async initiate(params: {
    initiatorPartnerId: string;
    receiverPartnerId: string;
    format: string;
    payload: string;
    notes?: string;
  }): Promise<ConnectionTest> {
    const { initiatorPartnerId, receiverPartnerId, format, payload, notes } = params;

    // Find active subscription between these two partners (either direction)
    const subResult = await this.db.query<{ id: string }>(
      `SELECT id FROM subscriptions
       WHERE ((subscriber_partner_id = $1 AND provider_partner_id = $2)
           OR (subscriber_partner_id = $2 AND provider_partner_id = $1))
         AND status = 'active'
       LIMIT 1`,
      [initiatorPartnerId, receiverPartnerId]
    );

    if (!subResult.rows.length) {
      throw new Error('No active subscription found between these partners');
    }
    const subscriptionId = subResult.rows[0].id;

    // Send as a real message through the integration flow
    let messageId: string | null = null;
    try {
      messageId = await this.messageRouter.route({
        sourcePartnerId: initiatorPartnerId,
        targetPartnerId: receiverPartnerId,
        format: format as Parameters<typeof this.messageRouter.route>[0]['format'],
        payload,
      });
    } catch {
      // Don't fail the whole validation if webhook isn't reachable — still create the record
    }

    const status = messageId ? 'delivered' : 'pending';

    const { rows } = await this.db.query<Record<string, unknown>>(
      `INSERT INTO connection_tests
         (subscription_id, initiator_partner_id, receiver_partner_id,
          format, test_payload, message_id, status, initiator_notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
       RETURNING *`,
      [subscriptionId, initiatorPartnerId, receiverPartnerId, format, payload, messageId, status, notes ?? null]
    );

    return this.enrichRow(rows[0]);
  }

  async list(params: {
    partnerId: string | null;
    role?: 'initiator' | 'receiver' | 'all';
    status?: string;
  }): Promise<ConnectionTest[]> {
    const { partnerId, role = 'all', status } = params;

    const conditions: string[] = [];
    const queryParams: unknown[] = [];
    let p = 1;

    if (partnerId) {
      if (role === 'initiator') {
        conditions.push(`ct.initiator_partner_id = $${p++}`);
        queryParams.push(partnerId);
      } else if (role === 'receiver') {
        conditions.push(`ct.receiver_partner_id = $${p++}`);
        queryParams.push(partnerId);
      } else {
        conditions.push(`(ct.initiator_partner_id = $${p} OR ct.receiver_partner_id = $${p})`);
        p++;
        queryParams.push(partnerId);
      }
    }

    if (status) {
      conditions.push(`ct.status = $${p++}`);
      queryParams.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT ct.*,
              ip.name AS initiator_partner_name,
              rp.name AS receiver_partner_name
       FROM connection_tests ct
       LEFT JOIN partners ip ON ip.id = ct.initiator_partner_id
       LEFT JOIN partners rp ON rp.id = ct.receiver_partner_id
       ${where}
       ORDER BY ct.created_at DESC`,
      queryParams
    );

    return rows.map((r) => this.enrichRow(r));
  }

  async confirm(id: string, receiverPartnerId: string, notes?: string): Promise<ConnectionTest | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `UPDATE connection_tests
       SET status = 'confirmed',
           receiver_notes = $1,
           confirmed_at = NOW(),
           updated_at = NOW()
       WHERE id = $2 AND receiver_partner_id = $3
         AND status IN ('pending','delivered')
       RETURNING *`,
      [notes ?? null, id, receiverPartnerId]
    );
    if (!rows.length) return null;
    return this.enrichRow(rows[0]);
  }

  async reject(id: string, receiverPartnerId: string, notes?: string): Promise<ConnectionTest | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `UPDATE connection_tests
       SET status = 'rejected',
           receiver_notes = $1,
           updated_at = NOW()
       WHERE id = $2 AND receiver_partner_id = $3
         AND status IN ('pending','delivered')
       RETURNING *`,
      [notes ?? null, id, receiverPartnerId]
    );
    if (!rows.length) return null;
    return this.enrichRow(rows[0]);
  }

  private enrichRow(row: Record<string, unknown>): ConnectionTest {
    return {
      id: row['id'] as string,
      subscriptionId: row['subscription_id'] as string,
      initiatorPartnerId: row['initiator_partner_id'] as string,
      receiverPartnerId: row['receiver_partner_id'] as string,
      initiatorPartnerName: (row['initiator_partner_name'] as string) ?? '',
      receiverPartnerName: (row['receiver_partner_name'] as string) ?? '',
      format: row['format'] as string,
      testPayload: row['test_payload'] as string,
      messageId: (row['message_id'] as string) ?? null,
      status: row['status'] as ConnectionTest['status'],
      initiatorNotes: (row['initiator_notes'] as string) ?? null,
      receiverNotes: (row['receiver_notes'] as string) ?? null,
      confirmedAt: (row['confirmed_at'] as string) ?? null,
      expiresAt: row['expires_at'] as string,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }
}
