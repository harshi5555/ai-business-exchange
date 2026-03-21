'use client';
import { useEffect, useState } from 'react';
import { subscriptionsApi, partnersApi, mappingsApi } from '@/lib/api';
import { Badge, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { statusColor, fmtDateTime, getPartnerId } from '@/lib/utils';
import { Link2, XCircle, CheckCircle, Copy, Check, Search, X, Tag, ChevronDown, ChevronUp, FileCode } from 'lucide-react';

interface Sub { id: string; subscriberPartnerId: string; providerPartnerId: string; status: string; createdAt: string; approvedAt?: string }
interface PartnerInfo { name: string; contactEmail: string }
interface PartnerSchema { id: string; messageType: string; format: string; version: number; mappingRules: { sourceField: string; targetField: string }[] }

function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      title={`Copy ID: ${value}`}
      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600 transition-colors font-mono"
    >
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      {value.slice(0, 8)}…
    </button>
  );
}

function PartnerCell({ partnerId, info, isMe }: { partnerId: string; info?: PartnerInfo; isMe: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-gray-900 text-sm">{info?.name ?? '—'}</span>
        {isMe && <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">You</span>}
      </div>
      <div className="text-xs text-gray-400 mt-0.5">{info?.contactEmail ?? ''}</div>
      <CopyId value={partnerId} />
    </div>
  );
}

// ─── Provider Schemas Panel ───────────────────────────────────────────────────
function ProviderSchemas({ providerId, providerName }: { providerId: string; providerName: string }) {
  const [open, setOpen] = useState(false);
  const [schemas, setSchemas] = useState<PartnerSchema[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (loaded) { setOpen(v => !v); return; }
    setOpen(true);
    setLoading(true);
    try {
      const r = await mappingsApi.getPartnerActiveSchemas(providerId);
      setSchemas((r.data as { data: PartnerSchema[] }).data ?? []);
      setLoaded(true);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  // Group by messageType
  const byType = schemas.reduce<Record<string, PartnerSchema[]>>((acc, s) => {
    (acc[s.messageType] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="mt-1">
      <button onClick={load}
        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
        <FileCode className="w-3.5 h-3.5" />
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {open ? 'Hide schemas' : `View ${providerName.split(' ')[0]}'s schemas`}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
          {loading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : schemas.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No active schemas published yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(byType).map(([msgType, versions]) => (
                <div key={msgType} className="flex items-start gap-2">
                  <Tag className="w-3.5 h-3.5 text-indigo-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-xs font-bold text-indigo-800 uppercase">{msgType}</span>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {versions.map(v => (
                        <span key={v.id} className="font-mono text-xs text-gray-500 bg-white border border-indigo-200 px-1.5 py-0.5 rounded">
                          {v.format.toUpperCase()} v{v.version} · {v.mappingRules.length} rules
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [partners, setPartners] = useState<Record<string, PartnerInfo>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const myId = getPartnerId();

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 4000);
  };

  const load = () => {
    Promise.all([
      subscriptionsApi.list(),
      partnersApi.list(1, 100),
    ]).then(([subsRes, partnersRes]) => {
      setSubs((subsRes.data as { data: Sub[] }).data ?? []);
      const map: Record<string, PartnerInfo> = {};
      const partnerList = (partnersRes.data as { data: { id: string; name: string; contactEmail: string }[] }).data ?? [];
      for (const p of partnerList) map[p.id] = { name: p.name, contactEmail: p.contactEmail };
      setPartners(map);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const action = async (fn: () => Promise<unknown>, key: string, successMsg: string) => {
    setWorking(key);
    try {
      await fn();
      showToast(true, successMsg);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? (err as { message?: string })?.message
        ?? 'Action failed';
      showToast(false, msg);
    } finally {
      setWorking(null);
    }
  };

  const q = search.toLowerCase();
  const filtered = subs.filter(s => {
    const sub = partners[s.subscriberPartnerId];
    const prov = partners[s.providerPartnerId];
    const matchesSearch = !q
      || sub?.name.toLowerCase().includes(q)
      || sub?.contactEmail.toLowerCase().includes(q)
      || prov?.name.toLowerCase().includes(q)
      || prov?.contactEmail.toLowerCase().includes(q)
      || s.subscriberPartnerId.toLowerCase().includes(q)
      || s.providerPartnerId.toLowerCase().includes(q)
      || s.status.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statuses = ['all', ...Array.from(new Set(subs.map(s => s.status)))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subscriptions</h1>
          <p className="text-gray-500 text-sm mt-1">Manage your partner data subscriptions</p>
        </div>
        {toast && (
          <div className={`text-sm px-4 py-2 rounded-lg border ${toast.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {toast.text}
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-12">Loading…</div>
      ) : subs.length === 0 ? (
        <Card>
          <div className="text-center py-8 text-gray-400">
            <Link2 className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p>No subscriptions yet. Browse the Partner Catalog to subscribe.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by name, email or ID…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white capitalize"
            >
              {statuses.map(s => (
                <option key={s} value={s} className="capitalize">{s === 'all' ? 'All statuses' : s}</option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Subscriber', 'Provider', 'Status', 'Created', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">
                      No subscriptions match your search.
                    </td>
                  </tr>
                ) : filtered.map(s => {
                  const canApprove = s.status === 'requested' && s.providerPartnerId === myId;
                  const awaitingApproval = s.status === 'requested' && s.subscriberPartnerId === myId;
                  const canTerminate = s.status !== 'terminated';
                  const providerName = partners[s.providerPartnerId]?.name ?? 'the provider';
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <PartnerCell partnerId={s.subscriberPartnerId} info={partners[s.subscriberPartnerId]} isMe={s.subscriberPartnerId === myId} />
                      </td>
                      <td className="px-4 py-3">
                        <PartnerCell partnerId={s.providerPartnerId} info={partners[s.providerPartnerId]} isMe={s.providerPartnerId === myId} />
                        {s.status === 'active' || s.status === 'requested' || s.status === 'approved' ? (
                          <ProviderSchemas providerId={s.providerPartnerId} providerName={partners[s.providerPartnerId]?.name ?? 'Provider'} />
                        ) : null}
                      </td>
                      <td className="px-4 py-3"><Badge label={s.status} className={statusColor(s.status)} /></td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDateTime(s.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-2">
                          {awaitingApproval && (
                            <span className="flex items-center gap-1.5 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2.5 py-1 rounded-lg whitespace-nowrap">
                              <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                              Awaiting {providerName}
                            </span>
                          )}
                          <div className="flex items-center gap-2">
                            {canApprove && (
                              <Button size="sm" variant="primary" loading={working === s.id + 'a'}
                                onClick={() => action(() => subscriptionsApi.approve(s.id), s.id + 'a', 'Subscription approved!')}>
                                <CheckCircle className="w-3.5 h-3.5 mr-1" />Approve
                              </Button>
                            )}
                            {canTerminate && (
                              <Button size="sm" variant="danger" loading={working === s.id + 't'}
                                onClick={() => action(() => subscriptionsApi.terminate(s.id), s.id + 't', 'Subscription terminated.')}>
                                <XCircle className="w-3.5 h-3.5 mr-1" />Terminate
                              </Button>
                            )}
                            {!canApprove && !canTerminate && !awaitingApproval && (
                              <span className="text-xs text-gray-300 italic">—</span>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

