import axios from 'axios';
import { getPool } from '@bx/database';
import { AgentRuntimeSnapshot, agentRuntimeRegistry } from './agentRuntimeRegistry';

type HealthStatus = 'healthy' | 'degraded' | 'offline';

interface ServiceProbe {
  id: string;
  name: string;
  healthPath: string;
  candidates: string[];
}

interface RawPipelineRow {
  received: string;
  processing: string;
  failed: string;
  retry_backlog: string;
  dead_lettered: string;
  delivered: string;
}

interface RawSummaryRow {
  approved_partners: string;
  active_subscriptions: string;
  total_messages: string;
  active_schemas: string;
}

function unique(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => !!value && value.length > 0)
    .filter((value, index, all) => all.indexOf(value) === index);
}

function countFrom(row: Record<string, unknown>, key: string): number {
  return parseInt((row[key] as string | undefined) ?? '0', 10);
}

export class MonitoringService {
  private db = getPool();

  async getOverview(): Promise<{
    summary: {
      approvedPartners: number;
      activeSubscriptions: number;
      totalMessages: number;
      activeSchemas: number;
      runningAgents: number;
      healthyServices: number;
      degradedServices: number;
      offlineServices: number;
    };
    services: Array<{
      id: string;
      name: string;
      status: HealthStatus;
      responseTimeMs: number | null;
      checkedAt: string;
      url: string;
      detail: string;
    }>;
    pipeline: Array<{
      id: string;
      label: string;
      count: number;
      tone: 'slate' | 'indigo' | 'amber' | 'red' | 'green';
      description: string;
    }>;
    agents: Array<AgentRuntimeSnapshot & {
      isRunning: boolean;
      eventsLastHour: number;
    }>;
    recentEvents: Array<Record<string, unknown>>;
    topology: {
      nodes: Array<{
        id: string;
        label: string;
        kind: 'entry' | 'service' | 'data';
        status: HealthStatus | 'active';
        metric?: string;
        detail?: string;
      }>;
      edges: Array<{
        from: string;
        to: string;
        label: string;
      }>;
    };
  }> {
    const [services, pipelineRow, summaryRow, recentEvents, eventCounts, agentSnapshots] = await Promise.all([
      this.probeServices(),
      this.fetchPipeline(),
      this.fetchSummary(),
      this.fetchRecentEvents(),
      this.fetchAgentEventCountsLastHour(),
      Promise.resolve(agentRuntimeRegistry.snapshot()),
    ]);

    const agents = agentSnapshots.map((agent) => ({
      ...agent,
      isRunning: agent.activeRuns > 0,
      eventsLastHour: eventCounts[agent.type] ?? 0,
    }));

    const healthyServices = services.filter((service) => service.status === 'healthy').length;
    const degradedServices = services.filter((service) => service.status === 'degraded').length;
    const offlineServices = services.filter((service) => service.status === 'offline').length;
    const runningAgents = agents.filter((agent) => agent.isRunning).length;

    const pipeline = [
      {
        id: 'received',
        label: 'Received',
        count: pipelineRow.received,
        tone: 'slate' as const,
        description: 'Accepted by the platform and waiting for downstream work.',
      },
      {
        id: 'processing',
        label: 'Processing',
        count: pipelineRow.processing,
        tone: 'indigo' as const,
        description: 'Actively being mapped, routed, or delivered.',
      },
      {
        id: 'retry-backlog',
        label: 'Retry backlog',
        count: pipelineRow.retryBacklog,
        tone: 'amber' as const,
        description: 'Failed deliveries still eligible for retry.',
      },
      {
        id: 'dead-lettered',
        label: 'Dead-lettered',
        count: pipelineRow.deadLettered,
        tone: 'red' as const,
        description: 'Messages that exhausted retries and need attention.',
      },
      {
        id: 'delivered',
        label: 'Delivered',
        count: pipelineRow.delivered,
        tone: 'green' as const,
        description: 'Successfully completed message deliveries.',
      },
    ];

    const topologyNodes = [
      { id: 'portal', label: 'Partner Portal', kind: 'entry' as const, status: 'active' as const, metric: `${summaryRow.approvedPartners} partners`, detail: 'User entry point' },
      { id: 'gateway', label: 'API Gateway', kind: 'service' as const, status: this.findServiceStatus(services, 'gateway'), metric: `${summaryRow.totalMessages} msgs`, detail: 'Auth + routing' },
      { id: 'auth-service', label: 'Auth Service', kind: 'service' as const, status: this.findServiceStatus(services, 'auth-service'), detail: 'JWT + tokens' },
      { id: 'partner-service', label: 'Partner Service', kind: 'service' as const, status: this.findServiceStatus(services, 'partner-service'), metric: `${summaryRow.approvedPartners} approved`, detail: 'Profiles + BYOLLM' },
      { id: 'subscription-service', label: 'Subscription Service', kind: 'service' as const, status: this.findServiceStatus(services, 'subscription-service'), metric: `${summaryRow.activeSubscriptions} active`, detail: 'Partner connections' },
      { id: 'integration-service', label: 'Integration Service', kind: 'service' as const, status: this.findServiceStatus(services, 'integration-service'), metric: `${pipelineRow.processing} processing`, detail: 'Routing + delivery' },
      { id: 'mapping-engine', label: 'Mapping Engine', kind: 'service' as const, status: this.findServiceStatus(services, 'mapping-engine'), metric: `${summaryRow.activeSchemas} active schemas`, detail: 'CDM transforms' },
      { id: 'agent-orchestrator', label: 'Agent Orchestrator', kind: 'service' as const, status: this.findServiceStatus(services, 'agent-orchestrator'), metric: `${runningAgents}/${agents.length} running`, detail: '4 scheduled agents' },
      { id: 'billing-service', label: 'Billing Service', kind: 'service' as const, status: this.findServiceStatus(services, 'billing-service'), detail: 'Usage + invoices' },
      { id: 'postgres', label: 'PostgreSQL', kind: 'data' as const, status: this.findServiceStatus(services, 'postgres'), metric: `${summaryRow.totalMessages} msgs stored`, detail: 'System of record' },
    ];

    return {
      summary: {
        approvedPartners: summaryRow.approvedPartners,
        activeSubscriptions: summaryRow.activeSubscriptions,
        totalMessages: summaryRow.totalMessages,
        activeSchemas: summaryRow.activeSchemas,
        runningAgents,
        healthyServices,
        degradedServices,
        offlineServices,
      },
      services,
      pipeline,
      agents,
      recentEvents,
      topology: {
        nodes: topologyNodes,
        edges: [
          { from: 'portal', to: 'gateway', label: 'All UI/API traffic' },
          { from: 'gateway', to: 'auth-service', label: 'JWT + token exchange' },
          { from: 'gateway', to: 'partner-service', label: 'Profiles + settings' },
          { from: 'gateway', to: 'subscription-service', label: 'Partner subscriptions' },
          { from: 'gateway', to: 'integration-service', label: 'Message ingestion' },
          { from: 'integration-service', to: 'mapping-engine', label: `${summaryRow.activeSchemas} active schema paths` },
          { from: 'gateway', to: 'agent-orchestrator', label: 'Runtime telemetry' },
          { from: 'gateway', to: 'billing-service', label: 'Usage + plans' },
          { from: 'partner-service', to: 'postgres', label: 'Partner records' },
          { from: 'subscription-service', to: 'postgres', label: `${summaryRow.activeSubscriptions} live links` },
          { from: 'integration-service', to: 'postgres', label: `${summaryRow.totalMessages} total messages` },
          { from: 'mapping-engine', to: 'postgres', label: 'Schema registry' },
          { from: 'agent-orchestrator', to: 'postgres', label: `${pipelineRow.retryBacklog} retry backlog` },
          { from: 'billing-service', to: 'postgres', label: 'Billing records' },
        ],
      },
    };
  }

  private async fetchPipeline(): Promise<{
    received: number;
    processing: number;
    failed: number;
    retryBacklog: number;
    deadLettered: number;
    delivered: number;
  }> {
    const { rows } = await this.db.query<RawPipelineRow>(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'received')      AS received,
        COUNT(*) FILTER (WHERE status = 'processing')    AS processing,
        COUNT(*) FILTER (WHERE status = 'failed')        AS failed,
        COUNT(*) FILTER (WHERE status = 'failed' AND retries < 3) AS retry_backlog,
        COUNT(*) FILTER (WHERE status = 'dead_lettered') AS dead_lettered,
        COUNT(*) FILTER (WHERE status = 'delivered')     AS delivered
      FROM messages
    `);

    const row = rows[0] ?? {
      received: '0',
      processing: '0',
      failed: '0',
      retry_backlog: '0',
      dead_lettered: '0',
      delivered: '0',
    };

    return {
      received: parseInt(row.received, 10),
      processing: parseInt(row.processing, 10),
      failed: parseInt(row.failed, 10),
      retryBacklog: parseInt(row.retry_backlog, 10),
      deadLettered: parseInt(row.dead_lettered, 10),
      delivered: parseInt(row.delivered, 10),
    };
  }

  private async fetchSummary(): Promise<{
    approvedPartners: number;
    activeSubscriptions: number;
    totalMessages: number;
    activeSchemas: number;
  }> {
    const { rows } = await this.db.query<RawSummaryRow>(`
      SELECT
        (SELECT COUNT(*) FROM partners WHERE status = 'approved') AS approved_partners,
        (SELECT COUNT(*) FROM subscriptions WHERE status = 'active') AS active_subscriptions,
        (SELECT COUNT(*) FROM messages) AS total_messages,
        (SELECT COUNT(*) FROM schema_registry WHERE is_active = true AND status IN ('auto_approved', 'approved')) AS active_schemas
    `);
    const row = rows[0] ?? {
      approved_partners: '0',
      active_subscriptions: '0',
      total_messages: '0',
      active_schemas: '0',
    };

    return {
      approvedPartners: parseInt(row.approved_partners, 10),
      activeSubscriptions: parseInt(row.active_subscriptions, 10),
      totalMessages: parseInt(row.total_messages, 10),
      activeSchemas: parseInt(row.active_schemas, 10),
    };
  }

  private async fetchRecentEvents(): Promise<Array<Record<string, unknown>>> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM agent_events ORDER BY created_at DESC LIMIT 8'
    );
    return rows;
  }

  private async fetchAgentEventCountsLastHour(): Promise<Record<string, number>> {
    const { rows } = await this.db.query<Array<{ agent_type: string; count: string }>[number]>(`
      SELECT agent_type, COUNT(*) AS count
      FROM agent_events
      WHERE created_at > NOW() - INTERVAL '1 hour'
      GROUP BY agent_type
    `);

    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.agent_type] = parseInt(row.count, 10);
    return counts;
  }

  private async probeServices(): Promise<Array<{
    id: string;
    name: string;
    status: HealthStatus;
    responseTimeMs: number | null;
    checkedAt: string;
    url: string;
    detail: string;
  }>> {
    const checkedAt = new Date().toISOString();
    const probes: ServiceProbe[] = [
      {
        id: 'gateway',
        name: 'API Gateway',
        healthPath: '/health',
        candidates: unique([process.env.GATEWAY_URL, 'http://gateway:3000', 'http://localhost:3000']),
      },
      {
        id: 'auth-service',
        name: 'Auth Service',
        healthPath: '/health',
        candidates: unique([process.env.AUTH_SERVICE_URL, 'http://auth-service:3001', 'http://localhost:3001']),
      },
      {
        id: 'partner-service',
        name: 'Partner Service',
        healthPath: '/health',
        candidates: unique([process.env.PARTNER_SERVICE_URL, 'http://partner-service:3002', 'http://localhost:3002']),
      },
      {
        id: 'subscription-service',
        name: 'Subscription Service',
        healthPath: '/health',
        candidates: unique([process.env.SUBSCRIPTION_SERVICE_URL, 'http://subscription-service:3003', 'http://localhost:3003']),
      },
      {
        id: 'integration-service',
        name: 'Integration Service',
        healthPath: '/health',
        candidates: unique([process.env.INTEGRATION_SERVICE_URL, 'http://integration-service:3004', 'http://localhost:3004']),
      },
      {
        id: 'mapping-engine',
        name: 'Mapping Engine',
        healthPath: '/health',
        candidates: unique([process.env.MAPPING_ENGINE_URL, 'http://mapping-engine:3005', 'http://localhost:3005']),
      },
      {
        id: 'agent-orchestrator',
        name: 'Agent Orchestrator',
        healthPath: '/health',
        candidates: unique([process.env.AGENT_ORCHESTRATOR_URL, 'http://agent-orchestrator:3006', 'http://localhost:3006']),
      },
      {
        id: 'billing-service',
        name: 'Billing Service',
        healthPath: '/health',
        candidates: unique([process.env.BILLING_SERVICE_URL, 'http://billing-service:3007', 'http://localhost:3007']),
      },
    ];

    const httpResults = await Promise.all(probes.map((probe) => this.probeHttpService(probe, checkedAt)));
    const postgresResult = await this.probePostgres(checkedAt);
    return [...httpResults, postgresResult];
  }

  private async probeHttpService(
    probe: ServiceProbe,
    checkedAt: string,
  ): Promise<{
    id: string;
    name: string;
    status: HealthStatus;
    responseTimeMs: number | null;
    checkedAt: string;
    url: string;
    detail: string;
  }> {
    let lastError = 'No endpoint candidates configured';

    for (const candidate of probe.candidates) {
      const url = `${candidate}${probe.healthPath}`;
      const startedAt = Date.now();
      try {
        const response = await axios.get(url, { timeout: 2000 });
        const responseTimeMs = Date.now() - startedAt;
        const status = responseTimeMs > 1500 ? 'degraded' : 'healthy';
        const serviceName = typeof response.data?.service === 'string' ? response.data.service : probe.name;
        return {
          id: probe.id,
          name: probe.name,
          status,
          responseTimeMs,
          checkedAt,
          url: candidate,
          detail: `${serviceName} responded ${response.status} in ${responseTimeMs}ms`,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Health probe failed';
      }
    }

    return {
      id: probe.id,
      name: probe.name,
      status: 'offline',
      responseTimeMs: null,
      checkedAt,
      url: probe.candidates[0] ?? 'unconfigured',
      detail: lastError,
    };
  }

  private async probePostgres(checkedAt: string): Promise<{
    id: string;
    name: string;
    status: HealthStatus;
    responseTimeMs: number | null;
    checkedAt: string;
    url: string;
    detail: string;
  }> {
    const startedAt = Date.now();
    try {
      await this.db.query('SELECT 1');
      const responseTimeMs = Date.now() - startedAt;
      return {
        id: 'postgres',
        name: 'PostgreSQL',
        status: responseTimeMs > 1500 ? 'degraded' : 'healthy',
        responseTimeMs,
        checkedAt,
        url: 'postgresql://configured',
        detail: `Database responded in ${responseTimeMs}ms`,
      };
    } catch (err) {
      return {
        id: 'postgres',
        name: 'PostgreSQL',
        status: 'offline',
        responseTimeMs: null,
        checkedAt,
        url: 'postgresql://configured',
        detail: err instanceof Error ? err.message : 'Database probe failed',
      };
    }
  }

  private findServiceStatus(
    services: Array<{ id: string; status: HealthStatus }>,
    id: string,
  ): HealthStatus {
    return services.find((service) => service.id === id)?.status ?? 'offline';
  }
}
