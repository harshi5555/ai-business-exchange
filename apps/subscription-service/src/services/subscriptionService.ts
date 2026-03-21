import { getPool } from '@bx/database';
import { generateId } from '@bx/shared-utils';
import { Subscription, SubscriptionStatus } from '@bx/shared-types';

export class SubscriptionService {
  private db = getPool();

  async create(subscriberPartnerId: string, providerPartnerId: string): Promise<Subscription> {
    // Check no duplicate active/pending subscription
    const { rows: existing } = await this.db.query<Record<string, unknown>>(
      `SELECT id, status FROM subscriptions WHERE subscriber_partner_id = $1 AND provider_partner_id = $2`,
      [subscriberPartnerId, providerPartnerId]
    );

    if (existing.length) {
      const existingStatus = existing[0]['status'] as string;
      if (existingStatus !== 'terminated') throw new Error('Subscription already exists');

      // Re-activate a previously terminated subscription (DB has unique constraint, so UPDATE not INSERT)
      const { rows } = await this.db.query<Record<string, unknown>>(
        `UPDATE subscriptions SET status = 'requested', updated_at = NOW()
         WHERE subscriber_partner_id = $1 AND provider_partner_id = $2 RETURNING *`,
        [subscriberPartnerId, providerPartnerId]
      );
      return this.mapRow(rows[0]);
    }

    const id = generateId();
    const { rows } = await this.db.query<Record<string, unknown>>(
      `INSERT INTO subscriptions (id, subscriber_partner_id, provider_partner_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'requested', NOW(), NOW()) RETURNING *`,
      [id, subscriberPartnerId, providerPartnerId]
    );
    return this.mapRow(rows[0]);
  }

  async listForPartner(partnerId: string): Promise<Subscription[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM subscriptions WHERE subscriber_partner_id = $1 OR provider_partner_id = $1 ORDER BY created_at DESC`,
      [partnerId]
    );
    return rows.map((r) => this.mapRow(r));
  }

  async approve(subscriptionId: string, approvingPartnerId: string): Promise<Subscription> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `UPDATE subscriptions SET status = 'active', approved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND provider_partner_id = $2 AND status = 'requested' RETURNING *`,
      [subscriptionId, approvingPartnerId]
    );
    if (!rows.length) throw new Error('Subscription not found or unauthorized');
    return this.mapRow(rows[0]);
  }

  async terminate(subscriptionId: string, partnerId: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE subscriptions SET status = 'terminated', updated_at = NOW()
       WHERE id = $1 AND (subscriber_partner_id = $2 OR provider_partner_id = $2)`,
      [subscriptionId, partnerId]
    );
    if (!rowCount) throw new Error('Subscription not found or unauthorized');
  }

  async listSendTargets(partnerId: string): Promise<{ partnerId: string; companyName: string; subscriptionId: string }[]> {
    // Return all active subscription partners in either direction — both parties can send once connected
    const { rows } = await this.db.query<{ partner_id: string; company_name: string; subscription_id: string }>(
      `SELECT DISTINCT ON (p.id) p.id AS partner_id, p.name AS company_name, s.id AS subscription_id
       FROM subscriptions s
       JOIN partners p ON p.id = CASE
         WHEN s.provider_partner_id = $1 THEN s.subscriber_partner_id
         ELSE s.provider_partner_id
       END
       WHERE (s.provider_partner_id = $1 OR s.subscriber_partner_id = $1)
         AND s.status = 'active'
       ORDER BY p.id, p.name ASC`,
      [partnerId]
    );
    return rows.map(r => ({ partnerId: r.partner_id, companyName: r.company_name, subscriptionId: r.subscription_id }));
  }

  async getActiveSubscriptions(providerPartnerId: string): Promise<Subscription[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM subscriptions WHERE provider_partner_id = $1 AND status = 'active'`,
      [providerPartnerId]
    );
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): Subscription {
    return {
      id: row['id'] as string,
      subscriberPartnerId: row['subscriber_partner_id'] as string,
      providerPartnerId: row['provider_partner_id'] as string,
      status: row['status'] as SubscriptionStatus,
      approvedAt: row['approved_at'] as Date | undefined,
      createdAt: row['created_at'] as Date,
      updatedAt: row['updated_at'] as Date,
    };
  }
}
