import { getPool } from '@bx/database';
import { generateId } from '@bx/shared-utils';
import { AgentType } from '@bx/shared-types';
import { Logger } from '@bx/logger';

export abstract class BaseAgent {
  protected db = getPool();
  protected abstract agentType: AgentType;

  constructor(protected logger: Logger) {}

  abstract run(): Promise<void>;

  protected async logEvent(
    entityId: string,
    action: string,
    outcome: 'success' | 'failure' | 'skipped',
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO agent_events (id, agent_type, entity_id, action, outcome, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [generateId(), this.agentType, entityId, action, outcome, JSON.stringify(metadata)]
      );
    } catch (err) {
      this.logger.warn({ err }, 'Failed to log agent event');
    }
  }
}
