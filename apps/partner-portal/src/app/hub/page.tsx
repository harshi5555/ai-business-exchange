'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { subscriptionsApi, integrationsApi, mappingsApi } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { fmtDateTime, cn, getPartnerId } from '@/lib/utils';
import { summarizeRelationship, type RelationshipUiStatus } from '@/lib/subscription-relationship';
import {
  Network, CheckCircle2, XCircle, Clock, AlertTriangle, ArrowRight,
  Send, ShieldCheck, Zap, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Subscription {
  id: string;
  subscriberPartnerId: string;
  providerPartnerId: string;
  subscriberName?: string;
  providerName?: string;
  status: string;
}

interface Capabilities {
  outboundFormats: string[];
  inboundFormats: string[];
  outboundTypes: string[];
  inboundTypes: string[];
}

interface PartnerStats {
  sent: number;
  received: number;
  delivered: number;
  failed: number;
  deadLettered: number;
  lastDeliveredAt: string | null;
}

interface ValidationSummary {
  confirmed: number;
  pending: number;
  rejected: number;
}

interface PartnerRelation {
  partnerId: string;
  partnerName: string;
  outboundStatus: string | null;
  inboundStatus: string | null;
  relationshipStatus: RelationshipUiStatus;
  role: 'subscriber' | 'provider' | 'both';
  myCaps: Capabilities | null;
  theirCaps: Capabilities | null;
  stats: PartnerStats | null;
  validation: ValidationSummary;
  loading: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const FORMATS = ['json', 'xml', 'csv', 'edi-x12', 'edifact'];

function overlap(a: string[], b: string[]) {
  return a.filter(f => b.includes(f));
}

function readinessSteps(rel: PartnerRelation, myPartnerId: string) {
  const mySentAny   = (rel.stats?.sent ?? 0) > 0;
  const theyHaveCap = (rel.theirCaps?.inboundFormats.length ?? 0) > 0 || (rel.theirCaps?.outboundFormats.length ?? 0) > 0;
  const iHaveCap    = (rel.myCaps?.outboundFormats.length ?? 0) > 0;
  const compatible  = overlap(rel.myCaps?.outboundFormats ?? [], rel.theirCaps?.inboundFormats ?? []).length > 0;
  const validated   = rel.validation.confirmed > 0;
  const firstMsg    = (rel.stats?.delivered ?? 0) > 0;
  const relationshipActive = rel.outboundStatus === 'active' || rel.inboundStatus === 'active';
  const relationshipPending = rel.outboundStatus === 'requested' || rel.outboundStatus === 'approved';

  return [
    { label: 'Relationship active',               done: relationshipActive, pending: !relationshipActive && relationshipPending },
    { label: 'My outbound schema registered',      done: iHaveCap },
    { label: 'Partner has inbound schema',         done: theyHaveCap },
    { label: 'Format compatible',                  done: compatible, warn: iHaveCap && theyHaveCap && !compatible },
    { label: 'Integration validated & confirmed',  done: validated,  pending: rel.validation.pending > 0 },
    { label: 'First message delivered',            done: firstMsg },
  ];
}

function readinessScore(steps: ReturnType<typeof readinessSteps>) {
  return steps.filter(s => s.done).length;
}

// ─── Step icon ────────────────────────────────────────────────────────────────
function StepIcon({ done, pending, warn }: { done: boolean; pending?: boolean; warn?: boolean }) {
  if (done)    return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
  if (warn)    return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
  if (pending) return <Clock className="w-4 h-4 text-blue-400 shrink-0" />;
  return <XCircle className="w-4 h-4 text-gray-300 shrink-0" />;
}

// ─── Format compatibility matrix ─────────────────────────────────────────────
function FormatMatrix({ myFormats, theirFormats }: { myFormats: string[]; theirFormats: string[] }) {
  if (myFormats.length === 0 && theirFormats.length === 0) {
    return <p className="text-xs text-gray-400 italic">No active schemas on either side yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {FORMATS.map(f => {
        const iHave   = myFormats.includes(f);
        const theyHave = theirFormats.includes(f);
        if (!iHave && !theyHave) return null;
        const match = iHave && theyHave;
        return (
          <span key={f} className={cn(
            'inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full border',
            match   ? 'bg-green-50 border-green-200 text-green-700'
            : iHave ? 'bg-blue-50 border-blue-200 text-blue-600'
                    : 'bg-gray-50 border-gray-200 text-gray-400',
          )}>
            {f.toUpperCase()}
            {match ? ' ✓' : iHave ? ' (mine)' : ' (theirs)'}
          </span>
        );
      })}
    </div>
  );
}

// ─── Delivery health bar ──────────────────────────────────────────────────────
function DeliveryBar({ stats }: { stats: PartnerStats }) {
  const total = stats.sent;
  if (total === 0) return <p className="text-xs text-gray-400 italic">No messages sent yet.</p>;
  const rate = Math.round((stats.delivered / total) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>{stats.delivered}/{total} delivered</span>
        <span className={cn('font-semibold', rate >= 90 ? 'text-green-600' : rate >= 70 ? 'text-amber-600' : 'text-red-600')}>
          {rate}% success
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', rate >= 90 ? 'bg-green-500' : rate >= 70 ? 'bg-amber-400' : 'bg-red-500')}
          style={{ width: `${rate}%` }}
        />
      </div>
      <div className="flex gap-3 text-xs text-gray-400 flex-wrap">
        {stats.failed > 0 && <span className="text-red-500">{stats.failed} failed</span>}
        {stats.deadLettered > 0 && <span className="text-red-700 font-medium">{stats.deadLettered} dead-lettered</span>}
        {stats.received > 0 && <span>{stats.received} received from them</span>}
        {stats.lastDeliveredAt && <span>Last: {fmtDateTime(stats.lastDeliveredAt)}</span>}
      </div>
    </div>
  );
}

// ─── Partner relationship card ────────────────────────────────────────────────
function RelationCard({ rel, myPartnerId }: { rel: PartnerRelation; myPartnerId: string }) {
  const [expanded, setExpanded] = useState(false);
  const steps = readinessSteps(rel, myPartnerId);
  const score = readinessScore(steps);
  const total = steps.length;
  const isReady = score === total;

  const readyColor = isReady ? 'text-green-700 bg-green-50 border-green-200'
    : score >= 4 ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-gray-500 bg-gray-50 border-gray-200';
  const relationSummary = `out ${rel.outboundStatus ?? 'none'} / in ${rel.inboundStatus ?? 'none'}`;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
            <Network className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm truncate">{rel.partnerName}</h3>
            <p className="text-xs text-gray-400 capitalize">{rel.role} · {rel.relationshipStatus} · {relationSummary}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <span className={cn('text-xs font-medium border rounded-full px-2.5 py-0.5', readyColor)}>
            {isReady ? '✓ Ready' : `${score}/${total} steps`}
          </span>
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Quick stats strip */}
      <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
        {[
          { label: 'Sent',      value: rel.stats?.sent ?? '—' },
          { label: 'Delivered', value: rel.stats?.delivered ?? '—' },
          { label: 'Validated', value: rel.validation.confirmed > 0 ? '✓' : rel.validation.pending > 0 ? '⏳' : '—' },
        ].map(stat => (
          <div key={stat.label} className="px-4 py-2.5 text-center">
            <p className="text-base font-bold text-gray-900">{stat.value}</p>
            <p className="text-xs text-gray-400">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-5 py-4 space-y-5">
          {rel.loading ? (
            <p className="text-xs text-gray-400 text-center py-4">Loading integration details…</p>
          ) : (
            <>
              {/* Readiness checklist */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Integration Checklist</p>
                <ul className="space-y-1.5">
                  {steps.map(step => (
                    <li key={step.label} className="flex items-center gap-2 text-sm">
                      <StepIcon done={step.done} pending={step.pending} warn={step.warn} />
                      <span className={step.done ? 'text-gray-700' : step.warn ? 'text-amber-700' : 'text-gray-400'}>
                        {step.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Format compatibility */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Format Compatibility
                  <span className="ml-2 font-normal normal-case text-gray-400">— green = both sides active</span>
                </p>
                <FormatMatrix
                  myFormats={rel.myCaps?.outboundFormats ?? []}
                  theirFormats={rel.theirCaps?.inboundFormats ?? []}
                />
                {(rel.myCaps?.outboundTypes.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {rel.myCaps!.outboundTypes.map(t => (
                      <span key={t} className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full uppercase">{t}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Delivery health */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Delivery Health</p>
                {rel.stats ? <DeliveryBar stats={rel.stats} /> : <p className="text-xs text-gray-400 italic">No stats available.</p>}
              </div>

              {/* Quick actions */}
              <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
                <Link
                  href="/mappings?tab=validate"
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />Validate Integration
                </Link>
                <Link
                  href={`/integrations?partner=${rel.partnerId}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />View Messages
                </Link>
                <Link
                  href="/mappings"
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200 transition-colors"
                >
                  <Zap className="w-3.5 h-3.5" />Manage Schemas
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function IntegrationHubPage() {
  const myPartnerId = typeof window !== 'undefined' ? getPartnerId() : null;
  const [relations, setRelations]   = useState<PartnerRelation[]>([]);
  const [loading, setLoading]       = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const loadHub = useCallback(async () => {
    if (!myPartnerId) return;
    setLoading(true);

    // 1. Load subscriptions
    const subRes = await subscriptionsApi.list().catch(() => null);
    const subs: Subscription[] = (subRes?.data as { data: Subscription[] })?.data ?? [];

    // 2. Load my own capabilities
    const myCapsRes = await mappingsApi.getPartnerCapabilities(myPartnerId).catch(() => null);
    const myCaps: Capabilities | null = (myCapsRes?.data as { data: Capabilities })?.data ?? null;

    // 3. Load all validations once
    const valRes = await integrationsApi.listValidations('all').catch(() => null);
    const allVals: { initiatorPartnerId: string; receiverPartnerId: string; status: string }[] =
      (valRes?.data as { data: typeof allVals })?.data ?? [];

    // 4. Build one relation per unique partner using both subscription directions
    const byPartner = new Map<string, PartnerRelation>();
    const partnerIds = Array.from(
      new Set(
        subs.flatMap((sub) => {
          if (sub.subscriberPartnerId === myPartnerId) return [sub.providerPartnerId];
          if (sub.providerPartnerId === myPartnerId) return [sub.subscriberPartnerId];
          return [];
        })
      )
    );

    for (const partnerId of partnerIds) {
      const partnerSubs = subs.filter(
        (sub) =>
          (sub.subscriberPartnerId === myPartnerId && sub.providerPartnerId === partnerId) ||
          (sub.subscriberPartnerId === partnerId && sub.providerPartnerId === myPartnerId)
      );
      const relationship = summarizeRelationship(partnerSubs, myPartnerId, partnerId);

      if (relationship.uiStatus === 'none' || relationship.uiStatus === 'terminated') continue;

      const role =
        relationship.outboundStatus && relationship.inboundStatus
          ? 'both'
          : relationship.outboundStatus
            ? 'subscriber'
            : 'provider';
      const partnerName =
        partnerSubs.find((sub) => sub.providerPartnerId === partnerId)?.providerName ??
        partnerSubs.find((sub) => sub.subscriberPartnerId === partnerId)?.subscriberName ??
        partnerId;
      const vals = allVals.filter(
        v => (v.initiatorPartnerId === myPartnerId && v.receiverPartnerId === partnerId) ||
             (v.initiatorPartnerId === partnerId   && v.receiverPartnerId === myPartnerId)
      );

      byPartner.set(partnerId, {
        partnerId,
        partnerName,
        outboundStatus: relationship.outboundStatus,
        inboundStatus: relationship.inboundStatus,
        relationshipStatus: relationship.uiStatus,
        role,
        myCaps,
        theirCaps: null,
        stats: null,
        validation: {
          confirmed: vals.filter(v => v.status === 'confirmed').length,
          pending:   vals.filter(v => v.status === 'pending' || v.status === 'delivered').length,
          rejected:  vals.filter(v => v.status === 'rejected').length,
        },
        loading: true,
      });
    }

    setRelations([...byPartner.values()]);
    setLoading(false);
    setLastRefresh(new Date());

    // 5. Enrich each partner with capabilities + stats in parallel
    await Promise.all(
      [...byPartner.values()].map(async rel => {
        const [capsRes, statsRes] = await Promise.all([
          mappingsApi.getPartnerCapabilities(rel.partnerId).catch(() => null),
          integrationsApi.getPartnerStats(rel.partnerId).catch(() => null),
        ]);
        setRelations(prev => prev.map(r =>
          r.partnerId !== rel.partnerId ? r : {
            ...r,
            theirCaps:  (capsRes?.data as { data: Capabilities })?.data ?? null,
            stats:      (statsRes?.data as { data: PartnerStats })?.data ?? null,
            loading: false,
          }
        ));
      })
    );
  }, [myPartnerId]);

  useEffect(() => { loadHub(); }, [loadHub]);

  const readyCount    = relations.filter(r => readinessScore(readinessSteps(r, myPartnerId ?? '')) === 6).length;
  const attentionCount = relations.filter(r => (r.stats?.failed ?? 0) > 0 || (r.stats?.deadLettered ?? 0) > 0).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Integration Hub</h1>
          <p className="text-gray-500 text-sm mt-1">
            Your integration readiness with each connected partner — checklist, format compatibility &amp; delivery health.
          </p>
        </div>
        <button
          onClick={loadHub}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh · {lastRefresh.toLocaleTimeString()}
        </button>
      </div>

      {/* Summary strip */}
      {!loading && relations.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Connected partners', value: relations.length,   color: 'text-indigo-700 bg-indigo-50 border-indigo-100' },
            { label: 'Fully ready',        value: readyCount,         color: 'text-green-700 bg-green-50 border-green-100' },
            { label: 'Need attention',     value: attentionCount,     color: attentionCount > 0 ? 'text-red-700 bg-red-50 border-red-100' : 'text-gray-500 bg-gray-50 border-gray-100' },
          ].map(s => (
            <div key={s.label} className={cn('rounded-xl border px-4 py-3 text-center', s.color)}>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <Card title="">
          <div className="text-center py-12 text-gray-400">
            <Network className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Loading your integrations…</p>
          </div>
        </Card>
      ) : relations.length === 0 ? (
        <Card title="">
          <div className="text-center py-12 text-gray-400">
            <Network className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-gray-600">No connected partners yet</p>
            <p className="text-sm mt-1">Subscribe to a partner in the <Link href="/partners" className="text-indigo-600 underline">Partner Catalog</Link> to get started.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Tip: click to expand */}
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <ChevronDown className="w-3.5 h-3.5" />
            Click a card to expand the checklist, format matrix and delivery details.
          </p>
          {relations.map(rel => (
            <RelationCard key={rel.partnerId} rel={rel} myPartnerId={myPartnerId ?? ''} />
          ))}
        </div>
      )}
    </div>
  );
}
