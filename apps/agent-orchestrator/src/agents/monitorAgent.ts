import { BaseAgent } from './baseAgent';
import { AgentType } from '@bx/shared-types';

export class MonitorAgent extends BaseAgent {
  protected agentType: AgentType = 'monitor';

  async run(): Promise<void> {
    this.logger.debug('MonitorAgent: running health check');
    try {
      // Check for stuck messages (processing > 5 min)
      const { rows: stuckMessages } = await this.db.query(`
        SELECT id, source_partner_id, target_partner_id FROM messages
        WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes'
      `);

      for (const msg of stuckMessages as Array<{ id: string; source_partner_id: string; target_partner_id: string }>) {
        await this.db.query(
          `UPDATE messages SET status = 'failed', updated_at = NOW() WHERE id = $1`,
          [msg.id]
        );
        await this.logEvent(msg.id, 'mark_stuck_failed', 'success', {
          sourcePartnerId: msg.source_partner_id,
          targetPartnerId: msg.target_partner_id,
        });
      }

      // Check error rate per partner (last 1h)
      const { rows: errorRates } = await this.db.query(`
        SELECT source_partner_id,
               COUNT(*) FILTER (WHERE status = 'failed') AS failures,
               COUNT(*) AS total
        FROM messages
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY source_partner_id
        HAVING COUNT(*) > 0
      `);

      for (const rate of errorRates as Array<{ source_partner_id: string; failures: string; total: string }>) {
        const errorRate = parseInt(rate.failures) / parseInt(rate.total);
        if (errorRate > 0.5) {
          await this.logEvent(rate.source_partner_id, 'high_error_rate', 'success', {
            errorRate,
            failures: rate.failures,
            total: rate.total,
          });
        }
      }

      if (stuckMessages.length > 0) {
        this.logger.info({ stuckCount: stuckMessages.length }, 'MonitorAgent: marked stuck messages as failed');
      }
    } catch (err) {
      this.logger.error({ err }, 'MonitorAgent: error during run');
      throw err;
    }
  }
}
