'use client';

import { useEffect, useMemo, useState } from 'react';
import { agentsApi, integrationsApi, partnersApi, subscriptionsApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge, Card, StatCard } from '@/components/ui/Card';
import { cn, fmtDateTime, getPartnerId, statusColor } from '@/lib/utils';
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowRight,
  Bot,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  Eye,
  EyeOff,
  LayoutDashboard,
  Link2,
  Network,
  Route,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Users,
  Workflow,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, PieChart, Pie, Cell, RadialBarChart, RadialBar,
} from 'recharts';

interface DailyVolume { date: string; sent: number; received: number }
interface Stats { byStatus: Record<string, number>; byFormat: Record<string, number>; dailyVolume: DailyVolume[] }
interface Sub { status: string; subscriberPartnerId: string; providerPartnerId: string }
interface ServiceHealth {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'offline';
  responseTimeMs: number | null;
  checkedAt: string;
  url: string;
  detail: string;
}
interface PipelineStage {
  id: string;
  label: string;
  count: number;
  tone: 'slate' | 'indigo' | 'amber' | 'red' | 'green';
  description: string;
}
interface AgentRuntime {
  type: string;
  name: string;
  schedule: string;
  intervalLabel: string;
  description: string;
  activeRuns: number;
  totalRuns: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastDurationMs: number | null;
  lastOutcome: 'success' | 'failure' | 'never';
  lastError: string | null;
  isRunning: boolean;
  eventsLastHour: number;
}
interface AgentEvent {
  id: string;
  agent_type: string;
  entity_id: string;
  action: string;
  outcome: string;
  metadata: Record<string, unknown>;
  created_at: string;
}
interface TopologyNode {
  id: string;
  label: string;
  kind: 'entry' | 'service' | 'data';
  status: 'healthy' | 'degraded' | 'offline' | 'active';
  metric?: string;
  detail?: string;
}
interface TopologyEdge {
  from: string;
  to: string;
  label: string;
}
interface DashboardOverview {
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
  services: ServiceHealth[];
  pipeline: PipelineStage[];
  agents: AgentRuntime[];
  recentEvents: AgentEvent[];
  topology: {
    nodes: TopologyNode[];
    edges: TopologyEdge[];
  };
}

type ViewMode = 'all' | 'business' | 'technical';
type SectionId =
  | 'platform-kpis'
  | 'runtime-kpis'
  | 'topology'
  | 'pipeline'
  | 'service-health'
  | 'agents'
  | 'message-analytics'
  | 'recent-messages'
  | 'recent-agent-activity';

interface SectionPreference {
  id: SectionId;
  visible: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  delivered: '#22c55e', processing: '#6366f1', received: '#94a3b8',
  failed: '#ef4444', dead_lettered: '#991b1b',
};
const FORMAT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6'];
const HEALTH_STYLES: Record<ServiceHealth['status'], string> = {
  healthy: 'bg-green-100 text-green-700',
  degraded: 'bg-yellow-100 text-yellow-700',
  offline: 'bg-red-100 text-red-700',
};
const PIPELINE_TONES: Record<PipelineStage['tone'], string> = {
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  red: 'border-red-200 bg-red-50 text-red-700',
  green: 'border-green-200 bg-green-50 text-green-700',
};

const DASHBOARD_SECTIONS: Array<{ id: SectionId; label: string; category: Exclude<ViewMode, 'all'>; description: string }> = [
  { id: 'platform-kpis', label: 'Platform KPIs', category: 'business', description: 'Core business counters for partners, subscriptions, and delivery.' },
  { id: 'message-analytics', label: 'Message Analytics', category: 'business', description: 'Volume, format mix, subscription mix, and delivery trend.' },
  { id: 'recent-messages', label: 'Recent Messages', category: 'business', description: 'Latest business exchanges between partners.' },
  { id: 'runtime-kpis', label: 'Runtime KPIs', category: 'technical', description: 'Service health, running agents, retry backlog, and dead letters.' },
  { id: 'topology', label: 'System Topology', category: 'technical', description: 'Graphical view of services, data stores, and connections.' },
  { id: 'pipeline', label: 'Logical Queues & Pipeline', category: 'technical', description: 'Backlog and progression across message processing stages.' },
  { id: 'service-health', label: 'Service Health', category: 'technical', description: 'Per-service health probe results and response times.' },
  { id: 'agents', label: 'Autonomous Agents', category: 'technical', description: 'Live runtime state and cadence of scheduled agents.' },
  { id: 'recent-agent-activity', label: 'Recent Agent Activity', category: 'technical', description: 'Latest automation actions and outcomes.' },
];

const DEFAULT_SECTION_PREFERENCES: SectionPreference[] = DASHBOARD_SECTIONS.map((section) => ({
  id: section.id,
  visible: true,
}));

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatAgo(d?: string | null) {
  if (!d) return 'Never';
  const diffMs = Date.now() - new Date(d).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function healthLabel(status: ServiceHealth['status'] | TopologyNode['status']) {
  if (status === 'healthy' || status === 'active') return 'Healthy';
  if (status === 'degraded') return 'Degraded';
  return 'Offline';
}

function topologyIcon(node: TopologyNode) {
  if (node.id === 'portal') return <Users className="w-4 h-4" />;
  if (node.id === 'gateway') return <Route className="w-4 h-4" />;
  if (node.id === 'postgres') return <Database className="w-4 h-4" />;
  if (node.id === 'agent-orchestrator') return <Bot className="w-4 h-4" />;
  if (node.id === 'mapping-engine') return <Workflow className="w-4 h-4" />;
  if (node.id === 'auth-service') return <ShieldCheck className="w-4 h-4" />;
  return <Server className="w-4 h-4" />;
}

function readDashboardPreferences(key: string): { viewMode: ViewMode; sections: SectionPreference[] } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { viewMode?: ViewMode; sections?: Array<Partial<SectionPreference>> };
    const incoming = Array.isArray(parsed.sections) ? parsed.sections : [];
    const byId = new Map(incoming
      .filter((item): item is SectionPreference => typeof item.id === 'string' && typeof item.visible === 'boolean')
      .map((item) => [item.id, item.visible]));

    const sections = DEFAULT_SECTION_PREFERENCES.map((section) => ({
      id: section.id,
      visible: byId.has(section.id) ? !!byId.get(section.id) : section.visible,
    }));

    incoming.forEach((item) => {
      if (!item.id || sections.some((section) => section.id === item.id)) return;
      sections.push({ id: item.id as SectionId, visible: !!item.visible });
    });

    return {
      viewMode: parsed.viewMode === 'business' || parsed.viewMode === 'technical' ? parsed.viewMode : 'all',
      sections,
    };
  } catch {
    return null;
  }
}

function persistDashboardPreferences(key: string, viewMode: ViewMode, sections: SectionPreference[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify({ viewMode, sections }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: <strong>{p.value}</strong></p>
      ))}
    </div>
  );
};

function TopologyNodeCard({ node }: { node: TopologyNode }) {
  const statusClass = node.status === 'active'
    ? 'bg-green-100 text-green-700'
    : HEALTH_STYLES[node.status];

  return (
    <div className="min-w-[180px] rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-gray-100 p-2 text-gray-600">
            {topologyIcon(node)}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{node.label}</p>
            <p className="text-[11px] uppercase tracking-wide text-gray-400">{node.kind}</p>
          </div>
        </div>
        <Badge label={healthLabel(node.status)} className={statusClass} />
      </div>
      {(node.metric || node.detail) && (
        <div className="mt-3 space-y-1">
          {node.metric && <p className="text-sm font-medium text-gray-700">{node.metric}</p>}
          {node.detail && <p className="text-xs text-gray-500">{node.detail}</p>}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const myId = getPartnerId() ?? '';
  const preferenceKey = `bx:dashboard-layout:${myId || 'anonymous'}`;
  const [stats, setStats] = useState({ partners: 0, subscriptions: 0, messages: 0, successRate: 0 });
  const [recentMessages, setRecentMessages] = useState<Record<string, unknown>[]>([]);
  const [msgStats, setMsgStats] = useState<Stats | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [partnerStatus, setPartnerStatus] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [sectionPrefs, setSectionPrefs] = useState<SectionPreference[]>(DEFAULT_SECTION_PREFERENCES);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  useEffect(() => {
    const saved = readDashboardPreferences(preferenceKey);
    if (saved) {
      setViewMode(saved.viewMode);
      setSectionPrefs(saved.sections);
    } else {
      setViewMode('all');
      setSectionPrefs(DEFAULT_SECTION_PREFERENCES);
    }
  }, [preferenceKey]);

  useEffect(() => {
    persistDashboardPreferences(preferenceKey, viewMode, sectionPrefs);
  }, [preferenceKey, sectionPrefs, viewMode]);

  useEffect(() => {
    if (myId) {
      partnersApi.get(myId)
        .then(r => setPartnerStatus((r.data as { data: { status: string } }).data?.status ?? null))
        .catch(() => {});
    }
    Promise.all([
      subscriptionsApi.list(),
      integrationsApi.listMessages({ limit: 5 }),
      integrationsApi.getStats(),
      agentsApi.getOverview(),
    ]).then(([s, m, ms, o]) => {
      const msgData = (m.data as { data?: Record<string, unknown>[]; total?: number });
      const subsData: Sub[] = ((s.data as { data?: Sub[] }).data ?? []);
      const statsData: Stats | null = (ms.data as { data: Stats }).data ?? null;
      const overviewData: DashboardOverview | null = (o.data as { data?: DashboardOverview }).data ?? null;
      const total = Object.values(statsData?.byStatus ?? {}).reduce((a, b) => a + b, 0);
      const delivered = (statsData?.byStatus?.['delivered'] ?? 0) + (statsData?.byStatus?.['received'] ?? 0);

      setStats({
        partners: overviewData?.summary.approvedPartners ?? 0,
        subscriptions: overviewData?.summary.activeSubscriptions ?? subsData.filter(sub => sub.status === 'active').length,
        messages: overviewData?.summary.totalMessages ?? msgData.total ?? 0,
        successRate: total > 0 ? Math.round((delivered / total) * 100) : 0,
      });
      setRecentMessages(msgData.data ?? []);
      setMsgStats(statsData);
      setSubs(subsData);
      setOverview(overviewData);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [myId]);

  const statusPieData = msgStats
    ? Object.entries(msgStats.byStatus).map(([name, value]) => ({ name, value }))
    : [];

  const formatBarData = msgStats
    ? Object.entries(msgStats.byFormat).map(([name, value]) => ({ name: name.toUpperCase(), value }))
    : [];

  const volumeData = (msgStats?.dailyVolume ?? []).map(d => ({ ...d, date: formatDate(d.date) }));
  const totalMessages = Object.values(msgStats?.byStatus ?? {}).reduce((a, b) => a + b, 0);

  const subStatusData = [
    { name: 'Active', value: subs.filter(sub => sub.status === 'active').length, fill: '#22c55e' },
    { name: 'Requested', value: subs.filter(sub => sub.status === 'requested').length, fill: '#f59e0b' },
    { name: 'Terminated', value: subs.filter(sub => sub.status === 'terminated').length, fill: '#94a3b8' },
  ].filter(item => item.value > 0);

  const successRateData = [{ name: 'Rate', value: stats.successRate, fill: stats.successRate > 80 ? '#22c55e' : stats.successRate > 50 ? '#f59e0b' : '#ef4444' }];
  const entryNode = overview?.topology.nodes.find(node => node.id === 'portal');
  const gatewayNode = overview?.topology.nodes.find(node => node.id === 'gateway');
  const databaseNode = overview?.topology.nodes.find(node => node.id === 'postgres');
  const serviceNodes = overview?.topology.nodes.filter(node => !['portal', 'gateway', 'postgres'].includes(node.id)) ?? [];
  const keyEdges = overview?.topology.edges.slice(0, 8) ?? [];
  const snapshotCards = overview ? [
    { label: 'Healthy Services', value: `${overview.summary.healthyServices}/${overview.services.length}`, icon: <Server className="w-5 h-5" />, color: 'green' as const },
    { label: 'Agents Running', value: `${overview.summary.runningAgents}/${overview.agents.length}`, icon: <Bot className="w-5 h-5" />, color: 'indigo' as const },
    { label: 'Retry Backlog', value: overview.pipeline.find(stage => stage.id === 'retry-backlog')?.count ?? 0, icon: <Clock className="w-5 h-5" />, color: 'yellow' as const },
    { label: 'Dead-letter Queue', value: overview.pipeline.find(stage => stage.id === 'dead-lettered')?.count ?? 0, icon: <AlertCircle className="w-5 h-5" />, color: 'red' as const },
  ] : [];

  const orderedSections = useMemo(() => {
    const definitions = new Map(DASHBOARD_SECTIONS.map(section => [section.id, section]));
    return sectionPrefs
      .map(pref => ({ pref, section: definitions.get(pref.id) }))
      .filter((entry): entry is { pref: SectionPreference; section: typeof DASHBOARD_SECTIONS[number] } => !!entry.section)
      .filter(({ pref, section }) => pref.visible && (viewMode === 'all' || section.category === viewMode));
  }, [sectionPrefs, viewMode]);

  const moveSection = (id: SectionId, direction: -1 | 1) => {
    setSectionPrefs((current) => {
      const index = current.findIndex(section => section.id === id);
      if (index < 0) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const toggleSectionVisibility = (id: SectionId) => {
    setSectionPrefs((current) => current.map(section => (
      section.id === id ? { ...section, visible: !section.visible } : section
    )));
  };

  const resetDashboardPreferences = () => {
    setViewMode('all');
    setSectionPrefs(DEFAULT_SECTION_PREFERENCES);
  };

  const renderSection = (id: SectionId) => {
    switch (id) {
      case 'platform-kpis':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Approved Partners" value={stats.partners} icon={<Users className="w-5 h-5" />} color="indigo" />
            <StatCard label="Active Subscriptions" value={stats.subscriptions} icon={<Link2 className="w-5 h-5" />} color="green" />
            <StatCard label="Total Messages" value={stats.messages} icon={<Send className="w-5 h-5" />} color="yellow" />
            <StatCard label="Delivery Success Rate" value={`${stats.successRate}%`} icon={<Activity className="w-5 h-5" />} color="indigo" />
          </div>
        );

      case 'runtime-kpis':
        return overview ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {snapshotCards.map(card => (
              <StatCard key={card.label} label={card.label} value={card.value} icon={card.icon} color={card.color} />
            ))}
          </div>
        ) : null;

      case 'topology':
        return overview ? (
          <Card title="System Topology" action={<span className="text-xs text-gray-400">Live platform map</span>}>
            <div className="space-y-5">
              <div className="flex flex-col items-center gap-3">
                {entryNode && <TopologyNodeCard node={entryNode} />}
                <ArrowDown className="w-4 h-4 text-gray-300" />
                {gatewayNode && <TopologyNodeCard node={gatewayNode} />}
                <ArrowDown className="w-4 h-4 text-gray-300" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {serviceNodes.map(node => <TopologyNodeCard key={node.id} node={node} />)}
              </div>

              <div className="flex flex-col items-center gap-3">
                <ArrowDown className="w-4 h-4 text-gray-300" />
                {databaseNode && <TopologyNodeCard node={databaseNode} />}
              </div>

              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Network className="w-4 h-4 text-indigo-500" />
                  <h3 className="text-sm font-semibold text-gray-900">Key Connections</h3>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {keyEdges.map(edge => (
                    <div key={`${edge.from}-${edge.to}-${edge.label}`} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                      <span className="font-medium text-gray-700">{overview.topology.nodes.find(node => node.id === edge.from)?.label ?? edge.from}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      <span className="font-medium text-gray-700">{overview.topology.nodes.find(node => node.id === edge.to)?.label ?? edge.to}</span>
                      <span className="ml-auto text-gray-400">{edge.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        ) : null;

      case 'pipeline':
        return overview ? (
          <Card title="Logical Queues & Pipeline">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {overview.pipeline.map((stage, index) => (
                <div key={stage.id} className="flex items-center gap-3">
                  <div className={cn('flex-1 rounded-xl border px-4 py-4', PIPELINE_TONES[stage.tone])}>
                    <p className="text-xs font-semibold uppercase tracking-wide">{stage.label}</p>
                    <p className="mt-2 text-3xl font-bold">{stage.count}</p>
                    <p className="mt-2 text-xs leading-relaxed opacity-80">{stage.description}</p>
                  </div>
                  {index < overview.pipeline.length - 1 && <ArrowRight className="hidden md:block w-4 h-4 text-gray-300 shrink-0" />}
                </div>
              ))}
            </div>
          </Card>
        ) : null;

      case 'service-health':
        return overview ? (
          <Card title="Service Health">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {overview.services.map(service => (
                <div key={service.id} className="rounded-xl border border-gray-200 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{service.name}</p>
                      <p className="text-xs text-gray-400">{service.url}</p>
                    </div>
                    <Badge label={healthLabel(service.status)} className={HEALTH_STYLES[service.status]} />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                    <span>{service.responseTimeMs == null ? 'No response' : `${service.responseTimeMs}ms`}</span>
                    <span>{formatAgo(service.checkedAt)}</span>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">{service.detail}</p>
                </div>
              ))}
            </div>
          </Card>
        ) : null;

      case 'agents':
        return overview ? (
          <Card title="Autonomous Agents" action={<span className="text-xs text-gray-400">4 scheduled agents</span>}>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {overview.agents.map(agent => (
                <div key={agent.type} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{agent.name}</p>
                      <p className="text-xs text-gray-400">{agent.intervalLabel}</p>
                    </div>
                    <Badge
                      label={agent.isRunning ? 'Running' : agent.lastOutcome === 'failure' ? 'Last run failed' : agent.lastOutcome === 'never' ? 'Not started' : 'Idle'}
                      className={agent.isRunning ? 'bg-indigo-100 text-indigo-700' : agent.lastOutcome === 'failure' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}
                    />
                  </div>
                  <p className="mt-3 text-xs text-gray-500 leading-relaxed">{agent.description}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-gray-400">Last run</p>
                      <p className="mt-1 font-medium text-gray-700">{formatAgo(agent.lastCompletedAt)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Duration</p>
                      <p className="mt-1 font-medium text-gray-700">{agent.lastDurationMs == null ? 'N/A' : `${agent.lastDurationMs}ms`}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Events / 1h</p>
                      <p className="mt-1 font-medium text-gray-700">{agent.eventsLastHour}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Total runs</p>
                      <p className="mt-1 font-medium text-gray-700">{agent.totalRuns}</p>
                    </div>
                  </div>
                  {agent.lastError && (
                    <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{agent.lastError}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ) : null;

      case 'message-analytics':
        return msgStats ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-indigo-500" />
                  <h3 className="text-sm font-semibold text-gray-900">Message Volume — Last 14 Days</h3>
                </div>
                <p className="text-xs text-gray-400 mb-4">{totalMessages} total messages</p>
                {volumeData.length === 0 ? (
                  <div className="flex items-center justify-center h-44 text-gray-400 text-sm">No data yet — send a message to get started</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={volumeData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="recvGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="sent" name="Sent" stroke="#6366f1" strokeWidth={2} fill="url(#sentGrad)" dot={{ r: 3, fill: '#6366f1' }} />
                      <Area type="monotone" dataKey="received" name="Received" stroke="#22c55e" strokeWidth={2} fill="url(#recvGrad)" dot={{ r: 3, fill: '#22c55e' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Message Status</h3>
                <p className="text-xs text-gray-400 mb-3">{totalMessages} total</p>
                {statusPieData.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No data yet</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={140}>
                      <PieChart>
                        <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2} strokeWidth={0}>
                          {statusPieData.map((entry) => (
                            <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? '#94a3b8'} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mt-2 space-y-1.5">
                      {statusPieData.map(entry => (
                        <div key={entry.name} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLORS[entry.name] ?? '#94a3b8' }} />
                            <span className="text-gray-600 capitalize">{entry.name.replace('_', ' ')}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-700">{entry.value}</span>
                            <span className="text-gray-400">{totalMessages > 0 ? Math.round((entry.value / totalMessages) * 100) : 0}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Messages by Format</h3>
                {formatBarData.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={formatBarData} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} width={60} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="value" name="Messages" radius={[0, 4, 4, 0]} maxBarSize={18}>
                        {formatBarData.map((_, index) => <Cell key={index} fill={FORMAT_COLORS[index % FORMAT_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Subscriptions</h3>
                <p className="text-xs text-gray-400 mb-3">{subs.length} total connections</p>
                {subStatusData.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No subscriptions yet</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={110}>
                      <PieChart>
                        <Pie data={subStatusData} cx="50%" cy="50%" outerRadius={50} dataKey="value" paddingAngle={2} strokeWidth={0}>
                          {subStatusData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mt-2 space-y-1.5">
                      {subStatusData.map(entry => (
                        <div key={entry.name} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ background: entry.fill }} />
                            <span className="text-gray-600">{entry.name}</span>
                          </div>
                          <span className="font-semibold text-gray-700">{entry.value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col items-center justify-center">
                <h3 className="text-sm font-semibold text-gray-900 mb-1 self-start">Delivery Success Rate</h3>
                <p className="text-xs text-gray-400 mb-3 self-start">Across all messages</p>
                <ResponsiveContainer width="100%" height={130}>
                  <RadialBarChart cx="50%" cy="50%" innerRadius={40} outerRadius={65} data={successRateData} startAngle={210} endAngle={-30}>
                    <RadialBar dataKey="value" cornerRadius={6} background={{ fill: '#f3f4f6' }} />
                  </RadialBarChart>
                </ResponsiveContainer>
                <p className="text-3xl font-bold mt-[-40px]" style={{ color: successRateData[0]?.fill ?? '#6366f1' }}>{stats.successRate}%</p>
                <p className="text-xs text-gray-400 mt-1">
                  {stats.successRate > 80 ? 'Excellent' : stats.successRate > 50 ? 'Needs attention' : 'Low — check failed messages'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center h-48 text-gray-400 text-sm">
            No message data yet — send your first message to see analytics
          </div>
        );

      case 'recent-messages':
        return (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <Send className="w-4 h-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-900">Recent Messages</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {recentMessages.length === 0 && <p className="px-6 py-4 text-sm text-gray-400">No messages yet.</p>}
              {recentMessages.map((message) => (
                <div key={message['id'] as string} className="px-6 py-3 flex items-center justify-between text-sm">
                  <div>
                    <p className="font-mono text-xs text-gray-600">{(message['id'] as string).slice(0, 8)}…</p>
                    <p className="text-gray-400 text-xs mt-0.5">
                      {(message['source_partner_name'] as string) ?? '?'} → {(message['target_partner_name'] as string) ?? '?'}
                      &nbsp;·&nbsp;{fmtDateTime(message['created_at'] as string)}
                    </p>
                  </div>
                  <Badge
                    label={message['status'] as string === 'delivered' && message['target_partner_id'] === myId ? 'received' : message['status'] as string}
                    className={statusColor(message['status'] as string)}
                  />
                </div>
              ))}
            </div>
          </div>
        );

      case 'recent-agent-activity':
        return (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <Bot className="w-4 h-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-900">Recent Agent Activity</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {(overview?.recentEvents ?? []).length === 0 && <p className="px-6 py-4 text-sm text-gray-400">No agent events yet.</p>}
              {(overview?.recentEvents ?? []).map((event) => (
                <div key={event.id} className="px-6 py-3 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {event.outcome === 'success'
                      ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      : <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
                    <div>
                      <p className="font-medium text-gray-800 text-xs">{event.agent_type} — {event.action}</p>
                      <p className="text-gray-400 text-xs">{fmtDateTime(event.created_at)}</p>
                    </div>
                  </div>
                  <Badge label={event.outcome} className={statusColor(event.outcome)} />
                </div>
              ))}
            </div>
          </div>
        );
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading dashboard…</div>;

  return (
    <div className="space-y-6">
      {partnerStatus === 'pending' && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3">
          <Clock className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-800">Account pending approval</p>
            <p className="text-xs text-yellow-700 mt-0.5">
              You can configure your <a href="/settings" className="underline font-medium">Partner Settings</a> now.
              Sending and receiving messages will be enabled once an admin approves your account.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Overview of your integration platform, runtime health, and message flow</p>
        </div>

        <div className="flex flex-col gap-3 xl:items-end">
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
            {(['business', 'technical', 'all'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  viewMode === mode ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                {mode === 'all' ? 'All' : mode === 'business' ? 'Business' : 'Technical'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>Preferences are saved to this browser for your account.</span>
            <Button variant="secondary" size="sm" onClick={() => setCustomizeOpen(open => !open)}>
              <Settings2 className="w-3.5 h-3.5 mr-1" />
              {customizeOpen ? 'Close layout editor' : 'Customize dashboard'}
            </Button>
          </div>
        </div>
      </div>

      {customizeOpen && (
        <Card title="Dashboard Layout & Visibility" action={<Button variant="ghost" size="sm" onClick={resetDashboardPreferences}>Reset defaults</Button>}>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Choose what to show, switch between business and technical views, and reorder sections with the arrows.
            </p>

            <div className="space-y-2">
              {sectionPrefs.map((pref, index) => {
                const meta = DASHBOARD_SECTIONS.find(section => section.id === pref.id);
                if (!meta) return null;

                return (
                  <div key={pref.id} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">{meta.label}</p>
                        <Badge label={meta.category} className={meta.category === 'business' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'} />
                        {!pref.visible && <Badge label="Hidden" className="bg-gray-100 text-gray-600" />}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{meta.description}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => toggleSectionVisibility(pref.id)}>
                        {pref.visible ? <EyeOff className="w-3.5 h-3.5 mr-1" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
                        {pref.visible ? 'Hide' : 'Show'}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => moveSection(pref.id, -1)}>
                        <ChevronUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" disabled={index === sectionPrefs.length - 1} onClick={() => moveSection(pref.id, 1)}>
                        <ChevronDown className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {orderedSections.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <LayoutDashboard className="w-10 h-10 text-gray-300" />
            <div>
              <p className="text-sm font-semibold text-gray-700">Nothing is visible in this view</p>
              <p className="text-sm text-gray-500 mt-1">Use the customization panel to show sections for this dashboard mode.</p>
            </div>
          </div>
        </Card>
      ) : (
        orderedSections.map(({ section }) => (
          <div key={section.id} data-section-id={section.id}>
            {renderSection(section.id)}
          </div>
        ))
      )}
    </div>
  );
}
