'use client';
import { useEffect, useState } from 'react';
import { agentsApi } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { statusColor, fmtDateTime } from '@/lib/utils';
import { Bot, CheckCircle, AlertCircle, MinusCircle, RefreshCw } from 'lucide-react';

interface AgentEvent { id: string; agent_type: string; entity_id: string; action: string; outcome: string; metadata: Record<string, unknown>; created_at: string }

const AGENTS = [
  { name: 'Monitor Agent',       type: 'monitor',       desc: 'Detects stuck messages and high error rates every minute', color: 'bg-indigo-100 text-indigo-700' },
  { name: 'Retry Agent',         type: 'retry',         desc: 'Re-delivers failed webhooks with exponential backoff every 2 min', color: 'bg-yellow-100 text-yellow-700' },
  { name: 'Schema Change Agent', type: 'schema-change', desc: 'Flags schema drift when error rates spike every 30 min', color: 'bg-orange-100 text-orange-700' },
  { name: 'Alert Agent',         type: 'alert',         desc: 'Notifies partners of dead-lettered messages every 5 min', color: 'bg-red-100 text-red-700' },
];

const outcomeIcon = (o: string) => {
  if (o === 'success') return <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />;
  if (o === 'failure') return <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />;
  return <MinusCircle className="w-4 h-4 text-gray-400 shrink-0" />;
};

export default function AgentsPage() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  const load = () => {
    agentsApi.listEvents(100).then(r => setEvents((r.data as { data: AgentEvent[] }).data ?? [])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  const filtered = filter ? events.filter(e => e.agent_type === filter) : events;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agent Monitor</h1>
          <p className="text-gray-500 text-sm mt-1">Autonomous agents running in the background · auto-refreshes every 30s</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button>
      </div>

      {/* Agent cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {AGENTS.map(a => {
          const count = events.filter(e => e.agent_type === a.type).length;
          return (
            <button key={a.type} onClick={() => setFilter(filter === a.type ? null : a.type)}
              className={`text-left p-4 rounded-xl border-2 transition-all ${filter === a.type ? 'border-indigo-500 shadow-md' : 'border-gray-200 bg-white hover:border-indigo-300'}`}>
              <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium mb-2 ${a.color}`}>
                <Bot className="w-3 h-3" />{a.name}
              </div>
              <p className="text-xs text-gray-500 leading-snug">{a.desc}</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">{count}<span className="text-xs font-normal text-gray-400 ml-1">events</span></p>
            </button>
          );
        })}
      </div>

      {/* Event log */}
      <Card title={filter ? `Events — ${filter}` : 'All Agent Events'} action={filter && <button className="text-xs text-indigo-600 hover:underline" onClick={() => setFilter(null)}>Clear filter</button>}>
        {loading ? (
          <div className="text-gray-400 text-center py-8">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Bot className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p>No events yet. Agents run on schedule — check back soon.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[32rem] overflow-y-auto">
            {filtered.map(e => (
              <div key={e.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                {outcomeIcon(e.outcome)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-700">{e.agent_type}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-xs text-gray-600">{e.action}</span>
                    {Object.keys(e.metadata ?? {}).length > 0 && (
                      <span className="text-xs text-gray-400 font-mono bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[300px]">
                        {JSON.stringify(e.metadata)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{fmtDateTime(e.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
