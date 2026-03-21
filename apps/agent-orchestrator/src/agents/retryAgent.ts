import axios from 'axios';
import { BaseAgent } from './baseAgent';
import { AgentType } from '@bx/shared-types';
import { backoffDelay, sleep, signPayload } from '@bx/shared-utils';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'changeme';

export class RetryAgent extends BaseAgent {
  protected agentType: AgentType = 'retry';

  async run(): Promise<void> {
    this.logger.debug('RetryAgent: scanning for failed messages');
    try {
      // Retry failed messages with < 3 retries, not dead-lettered
      const { rows: failedMessages } = await this.db.query(`
        SELECT m.id, m.raw_payload, m.format, m.source_partner_id, m.target_partner_id, m.retries,
               p.webhook_url
        FROM messages m
        JOIN partners p ON m.target_partner_id = p.id
        WHERE m.status = 'failed'
          AND m.retries < 3
          AND p.webhook_url IS NOT NULL
          AND m.updated_at < NOW() - INTERVAL '2 minutes'
        LIMIT 20
      `);

      for (const msg of failedMessages as Array<{
        id: string; raw_payload: string; format: string;
        source_partner_id: string; target_partner_id: string;
        retries: number; webhook_url: string;
      }>) {
        await sleep(backoffDelay(msg.retries));
        const delivered = await this.attempt(msg);
        const newRetries = msg.retries + 1;
        const newStatus = delivered ? 'delivered' : newRetries >= 3 ? 'dead_lettered' : 'failed';

        await this.db.query(
          `UPDATE messages SET status = $2, retries = $3, updated_at = NOW() WHERE id = $1`,
          [msg.id, newStatus, newRetries]
        );
        await this.logEvent(msg.id, 'retry_delivery', delivered ? 'success' : 'failure', {
          attempt: newRetries,
          status: newStatus,
        });
      }
    } catch (err) {
      this.logger.error({ err }, 'RetryAgent: error during run');
      throw err;
    }
  }

  private async attempt(msg: { id: string; raw_payload: string; format: string; source_partner_id: string; webhook_url: string }): Promise<boolean> {
    try {
      const signature = signPayload(msg.raw_payload, WEBHOOK_SECRET);
      const res = await axios.post(msg.webhook_url, msg.raw_payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-BX-Message-Id': msg.id,
          'X-BX-Source-Partner': msg.source_partner_id,
          'X-BX-Signature': `sha256=${signature}`,
          'X-BX-Retry': 'true',
        },
        timeout: 10000,
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }
}
