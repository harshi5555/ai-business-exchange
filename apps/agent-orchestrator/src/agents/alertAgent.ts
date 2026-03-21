import { BaseAgent } from './baseAgent';
import { AgentType } from '@bx/shared-types';

export class AlertAgent extends BaseAgent {
  protected agentType: AgentType = 'alert';

  async run(): Promise<void> {
    this.logger.debug('AlertAgent: checking for alert conditions');
    try {
      // Find partners with dead-lettered messages in last 5 min
      const { rows: deadLettered } = await this.db.query(`
        SELECT target_partner_id, COUNT(*) AS count
        FROM messages
        WHERE status = 'dead_lettered'
          AND updated_at > NOW() - INTERVAL '5 minutes'
        GROUP BY target_partner_id
      `);

      for (const row of deadLettered as Array<{ target_partner_id: string; count: string }>) {
        await this.logEvent(row.target_partner_id, 'dead_letter_alert', 'success', {
          deadLetteredCount: row.count,
          window: '5 minutes',
        });
        // In production: send email/Slack notification to partner
        this.logger.warn(
          { partnerId: row.target_partner_id, count: row.count },
          'AlertAgent: partner has dead-lettered messages'
        );
      }

      // Find schemas needing review
      const { rows: driftedSchemas } = await this.db.query(`
        SELECT partner_id, id FROM schema_registry
        WHERE status = 'drift_suspected'
          AND updated_at > NOW() - INTERVAL '5 minutes'
      `);

      for (const schema of driftedSchemas as Array<{ partner_id: string; id: string }>) {
        await this.logEvent(schema.partner_id, 'schema_review_alert', 'success', {
          schemaId: schema.id,
        });
        this.logger.warn(
          { partnerId: schema.partner_id, schemaId: schema.id },
          'AlertAgent: schema requires review due to suspected drift'
        );
      }
    } catch (err) {
      this.logger.error({ err }, 'AlertAgent: error during run');
      throw err;
    }
  }
}
