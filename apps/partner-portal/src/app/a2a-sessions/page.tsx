'use client';
import React, { useEffect, useState } from 'react';
import { a2aApi } from '@/lib/api';
import { Card, Badge } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { fmtDateTime } from '@/lib/utils';
import { Workflow, RefreshCw, ChevronDown, ChevronUp, Bot, CheckCircle, AlertCircle, Clock, Loader2 } from 'lucide-react';

interface NegotiationMessage {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
}

interface AgentSession {
  id: string;
  a2aTaskId?: string;
  state: string;
  partnerName?: string;
  partnerDomain?: string;
  partnerEmail?: string;
  webhookUrl?: string;
  supportedFormats: string[];
  negotiationContext: NegotiationMessage[];
  proposedMapping?: unknown;
  proposedSubscriptions?: unknown;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

const STATE_META: Record<string, { label: string; variant: string; icon: React.ReactElement }> = {
  discovery:        { label: 'Discovery',         variant: 'info',    icon: <Clock className="w-3 h-3" /> },
  schema_submitted: { label: 'Schema Submitted',  variant: 'info',    icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  mapping_proposed: { label: 'Mapping Proposed',  variant: 'warning', icon: <Clock className="w-3 h-3" /> },
  counter_offered:  { label: 'Counter Offered',   variant: 'warning', icon: <Clock className="w-3 h-3" /> },
  terms_negotiated: { label: 'Terms Agreed',      variant: 'info',    icon: <CheckCircle className="w-3 h-3" /> },
  provisioning:     { label: 'Provisioning',      variant: 'info',    icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  active:           { label: 'Active',            variant: 'success', icon: <CheckCircle className="w-3 h-3" /> },
  failed:           { label: 'Failed',            variant: 'danger',  icon: <AlertCircle className="w-3 h-3" /> },
  abandoned:        { label: 'Abandoned',         variant: 'default', icon: <AlertCircle className="w-3 h-3" /> },
};

function SessionRow({ session }: { session: AgentSession }) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATE_META[session.state] ?? { label: session.state, variant: 'default', icon: null };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header row */}
      <button
        className="w-full flex items-center gap-4 px-5 py-4 bg-white hover:bg-gray-50 transition-colors text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm truncate">
              {session.partnerName ?? session.a2aTaskId ?? session.id.slice(0, 12)}
            </span>
            {session.partnerDomain && (
              <span className="text-xs text-gray-400">{session.partnerDomain}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <Badge variant={meta.variant as 'default'}>
              <span className="flex items-center gap-1">{meta.icon}{meta.label}</span>
            </Badge>
            {session.supportedFormats.length > 0 && (
              <span className="text-xs text-gray-400">{session.supportedFormats.join(', ')}</span>
            )}
            <span className="text-xs text-gray-400">{fmtDateTime(session.updatedAt)}</span>
          </div>
        </div>
        <div className="shrink-0 text-gray-400">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-4 space-y-4">
          {/* Meta */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs text-gray-600">
            {session.partnerEmail  && <div><span className="font-medium">Email: </span>{session.partnerEmail}</div>}
            {session.webhookUrl    && <div><span className="font-medium">Webhook: </span><span className="truncate">{session.webhookUrl}</span></div>}
            {session.a2aTaskId     && <div><span className="font-medium">Task ID: </span><span className="font-mono">{session.a2aTaskId}</span></div>}
            {session.errorMessage  && <div className="col-span-full text-red-600"><span className="font-medium">Error: </span>{session.errorMessage}</div>}
            {session.completedAt   && <div><span className="font-medium">Completed: </span>{fmtDateTime(session.completedAt)}</div>}
          </div>

          {/* Negotiation transcript */}
          {session.negotiationContext.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Negotiation Transcript</p>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {session.negotiationContext.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 ${msg.role === 'agent' ? 'justify-start' : 'justify-end'}`}
                  >
                    {msg.role === 'agent' && (
                      <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-3.5 h-3.5 text-indigo-600" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                        msg.role === 'agent'
                          ? 'bg-white border border-gray-200 text-gray-800'
                          : 'bg-indigo-600 text-white'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Proposed mapping rules */}
          {session.proposedMapping !== undefined && session.proposedMapping !== null && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Proposed Mapping</p>
              <pre className="text-xs bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto max-h-40">
                {JSON.stringify(session.proposedMapping, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function A2ASessionsPage() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<string | null>(null);
  const pageSize = 20;

  const load = (p = page) => {
    setLoading(true);
    a2aApi.listSessions(p, pageSize)
      .then((r) => {
        const body = r.data as { data: AgentSession[]; total: number };
        setSessions(body.data ?? []);
        setTotal(body.total ?? 0);
      })
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = filter ? sessions.filter((s) => s.state === filter) : sessions;

  const stateCounts = sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.state] = (acc[s.state] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">A2A Sessions</h1>
          <p className="text-gray-500 text-sm mt-1">
            Agent-to-agent negotiation sessions — partner agents autonomously onboarding to the platform
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => load(page)}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh
        </Button>
      </div>

      {/* State filter pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            !filter ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All ({sessions.length})
        </button>
        {Object.entries(STATE_META).map(([state, meta]) => {
          const count = stateCounts[state] ?? 0;
          if (count === 0) return null;
          return (
            <button
              key={state}
              onClick={() => setFilter(filter === state ? null : state)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === state ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {meta.icon}{meta.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Session list */}
      <Card>
        {loading ? (
          <div className="text-center py-12 text-gray-400">
            <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin opacity-40" />
            <p>Loading sessions…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Workflow className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">No A2A sessions yet</p>
            <p className="text-sm mt-1">
              Sessions appear here when a partner agent connects via{' '}
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">POST /a2a/tasks</code>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </div>
        )}
      </Card>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{total} sessions total</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
            <span className="px-3 py-1.5 text-gray-700">Page {page} of {Math.ceil(total / pageSize)}</span>
            <Button variant="secondary" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil(total / pageSize)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
