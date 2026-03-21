import { AgentType } from '@bx/shared-types';

export interface AgentDefinition {
  type: AgentType;
  name: string;
  schedule: string;
  intervalLabel: string;
  description: string;
}

export interface AgentRuntimeSnapshot extends AgentDefinition {
  activeRuns: number;
  totalRuns: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastDurationMs: number | null;
  lastOutcome: 'success' | 'failure' | 'never';
  lastError: string | null;
}

const DEFAULT_DEFINITIONS: AgentDefinition[] = [
  {
    type: 'monitor',
    name: 'Monitor Agent',
    schedule: '* * * * *',
    intervalLabel: 'Every minute',
    description: 'Detects stuck messages and unusual failure rates.',
  },
  {
    type: 'retry',
    name: 'Retry Agent',
    schedule: '*/2 * * * *',
    intervalLabel: 'Every 2 minutes',
    description: 'Retries failed webhook deliveries with backoff.',
  },
  {
    type: 'schema-change',
    name: 'Schema Change Agent',
    schedule: '*/30 * * * *',
    intervalLabel: 'Every 30 minutes',
    description: 'Flags possible schema drift when failures spike.',
  },
  {
    type: 'alert',
    name: 'Alert Agent',
    schedule: '*/5 * * * *',
    intervalLabel: 'Every 5 minutes',
    description: 'Emits alerts for dead-letter and drift review conditions.',
  },
];

class AgentRuntimeRegistry {
  private states = new Map<AgentType, AgentRuntimeSnapshot>();

  initialize(definitions: AgentDefinition[] = DEFAULT_DEFINITIONS): void {
    for (const definition of definitions) {
      const previous = this.states.get(definition.type);
      this.states.set(definition.type, {
        ...definition,
        activeRuns: previous?.activeRuns ?? 0,
        totalRuns: previous?.totalRuns ?? 0,
        lastStartedAt: previous?.lastStartedAt ?? null,
        lastCompletedAt: previous?.lastCompletedAt ?? null,
        lastDurationMs: previous?.lastDurationMs ?? null,
        lastOutcome: previous?.lastOutcome ?? 'never',
        lastError: previous?.lastError ?? null,
      });
    }
  }

  async runTracked(type: AgentType, task: () => Promise<void>): Promise<void> {
    const state = this.states.get(type);
    if (!state) throw new Error(`Agent runtime state missing for ${type}`);

    const startedAt = Date.now();
    state.activeRuns += 1;
    state.totalRuns += 1;
    state.lastStartedAt = new Date(startedAt).toISOString();

    try {
      await task();
      state.lastOutcome = 'success';
      state.lastError = null;
    } catch (err) {
      state.lastOutcome = 'failure';
      state.lastError = err instanceof Error ? err.message : 'Unknown agent error';
      throw err;
    } finally {
      state.activeRuns = Math.max(0, state.activeRuns - 1);
      state.lastCompletedAt = new Date().toISOString();
      state.lastDurationMs = Date.now() - startedAt;
    }
  }

  snapshot(): AgentRuntimeSnapshot[] {
    return Array.from(this.states.values());
  }
}

export const agentRuntimeRegistry = new AgentRuntimeRegistry();
export const AGENT_DEFINITIONS = DEFAULT_DEFINITIONS;
