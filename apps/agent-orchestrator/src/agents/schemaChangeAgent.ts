import { BaseAgent } from './baseAgent';
import { AgentType } from '@bx/shared-types';

export class SchemaChangeAgent extends BaseAgent {
  protected agentType: AgentType = 'schema-change';

  async run(): Promise<void> {
    this.logger.debug('SchemaChangeAgent: checking for schema drift');
    try {
      // Detect partners with high transformation failure rates (potential schema drift)
      const { rows } = await this.db.query(`
        SELECT m.source_partner_id,
               COUNT(*) FILTER (WHERE m.status = 'failed') AS failures,
               COUNT(*) AS total,
               MAX(sr.created_at) AS schema_created_at
        FROM messages m
        JOIN schema_registry sr ON m.source_partner_id = sr.partner_id
        WHERE m.created_at > NOW() - INTERVAL '2 hours'
          AND sr.status IN ('auto_approved', 'approved')
        GROUP BY m.source_partner_id
        HAVING COUNT(*) > 5
          AND (COUNT(*) FILTER (WHERE m.status = 'failed')::float / COUNT(*)) > 0.3
      `);

      for (const row of rows as Array<{ source_partner_id: string; failures: string; total: string }>) {
        // Flag schema as potentially drifted
        await this.db.query(`
          UPDATE schema_registry SET status = 'drift_suspected', updated_at = NOW()
          WHERE partner_id = $1 AND status IN ('auto_approved', 'approved')
        `, [row.source_partner_id]);

        await this.logEvent(row.source_partner_id, 'schema_drift_detected', 'success', {
          failures: row.failures,
          total: row.total,
          errorRate: parseInt(row.failures) / parseInt(row.total),
        });

        this.logger.warn(
          { partnerId: row.source_partner_id, errorRate: parseInt(row.failures) / parseInt(row.total) },
          'SchemaChangeAgent: drift suspected, schema flagged for review'
        );
      }
    } catch (err) {
      this.logger.error({ err }, 'SchemaChangeAgent: error during run');
      throw err;
    }
  }
}
