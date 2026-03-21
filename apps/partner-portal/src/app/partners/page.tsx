'use client';
import { useEffect, useState } from 'react';
import { adminApi, partnersApi, subscriptionsApi } from '@/lib/api';
import { Badge, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { statusColor, fmtDate, getPartnerId, isAdmin } from '@/lib/utils';
import { summarizeRelationship, type RelationshipSummary } from '@/lib/subscription-relationship';
import { Users, Globe, Mail, Link2, Search, X, CheckCircle, Clock, Ban, ShieldCheck } from 'lucide-react';

interface Partner { id: string; name: string; domain: string; contactEmail: string; status: string; supportedFormats: string[]; supportedMessageTypes: string[]; createdAt: string }
interface Subscription { id: string; subscriberPartnerId: string; providerPartnerId: string; status: string }

export default function PartnersPage() {
  const admin = isAdmin();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const myId = getPartnerId();

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 4000);
  };

  const load = () => {
    Promise.all([
      admin ? adminApi.listAll() : partnersApi.list(1, 50),
      subscriptionsApi.list(),
    ]).then(([p, s]) => {
      setPartners((p.data as { data: Partner[] }).data ?? []);
      setSubs((s.data as { data: Subscription[] }).data ?? []);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [admin]);

  const subscribe = async (partnerId: string) => {
    setSubscribing(partnerId);
    try {
      await subscriptionsApi.create(partnerId);
      showToast(true, 'Subscription request sent! Waiting for partner approval.');
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as { message?: string })?.message ?? 'Request failed';
      showToast(false, msg);
    } finally {
      setSubscribing(null);
    }
  };

  const q = search.toLowerCase();
  const allMessageTypes = ['all', ...Array.from(new Set(partners.flatMap(p => p.supportedMessageTypes ?? [])))].sort();
  const filtered = partners
    .filter(p => p.id !== myId)
    .filter(p => {
      const matchesSearch = !q
        || p.name.toLowerCase().includes(q)
        || p.domain.toLowerCase().includes(q)
        || p.contactEmail.toLowerCase().includes(q);
      const matchesType = typeFilter === 'all' || (p.supportedMessageTypes ?? []).includes(typeFilter);
      return matchesSearch && matchesType;
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Partner Catalog</h1>
          <p className="text-gray-500 text-sm mt-1">
            {admin ? 'Platform-wide directory of partner organizations and their current status' : 'Discover and connect with approved partners'}
          </p>
        </div>
        {toast && (
          <div className={`text-sm px-4 py-2 rounded-lg border ${toast.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {toast.text}
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-12">Loading partners…</div>
      ) : partners.length === 0 ? (
        <Card>
          <div className="text-center py-8 text-gray-400">
            <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p>No approved partners yet.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {admin && (
            <div className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
              <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-indigo-800">Admin directory view</p>
                <p className="text-xs text-indigo-700 mt-0.5">
                  You’re viewing partner organizations as the platform operator. Subscription actions are hidden here to avoid treating admin as a trading partner.
                </p>
              </div>
            </div>
          )}

          {/* Search + filter bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by name, domain or email…"
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
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {allMessageTypes.map(t => (
                <option key={t} value={t}>{t === 'all' ? 'All message types' : t}</option>
              ))}
            </select>
          </div>

          {filtered.length === 0 ? (
            <Card>
              <div className="text-center py-8 text-gray-400">
                <Search className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p>No partners match your search.</p>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(p => {
                const relationship = summarizeRelationship(subs, myId, p.id);
                return (
                  <div key={p.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-lg">
                          {p.name[0]}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{p.name}</p>
                          <Badge label={p.status} className={statusColor(p.status)} />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1 text-sm text-gray-500">
                      <div className="flex items-center gap-2"><Globe className="w-3.5 h-3.5" />{p.domain}</div>
                      <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5" />{p.contactEmail}</div>
                    </div>
                    <div className="flex flex-wrap gap-1 min-h-[1.5rem]">
                      {(p.supportedMessageTypes ?? []).length > 0
                        ? p.supportedMessageTypes.map(t => (
                            <span key={t} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-xs font-medium">{t}</span>
                          ))
                        : <span className="text-xs text-gray-400 italic">No message types defined</span>
                      }
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-gray-400">Since {fmtDate(p.createdAt)}</span>
                      {admin ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg">
                          <ShieldCheck className="w-3.5 h-3.5" /> Operator view
                        </span>
                      ) : (
                        <SubscribeAction
                          relationship={relationship}
                          loading={subscribing === p.id}
                          onSubscribe={() => subscribe(p.id)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubscribeAction({ relationship, loading, onSubscribe }: {
  relationship: RelationshipSummary;
  loading: boolean;
  onSubscribe: () => void;
}) {
  const reconnect = relationship.outboundStatus === 'terminated';

  if (relationship.uiStatus === 'connected') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg">
        <CheckCircle className="w-3.5 h-3.5" /> Connected
      </span>
    );
  }

  if (relationship.uiStatus === 'pending') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 px-2.5 py-1 rounded-lg">
        <Clock className="w-3.5 h-3.5" /> Pending approval
      </span>
    );
  }

  if (relationship.uiStatus === 'suspended') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg">
        <Ban className="w-3.5 h-3.5" /> Suspended
      </span>
    );
  }

  if (relationship.uiStatus === 'partial') {
    return (
      <div className="flex flex-col items-end gap-2">
        <span
          title={relationship.label}
          className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg"
        >
          <Clock className="w-3.5 h-3.5" /> Partially connected
        </span>
        <Button size="sm" variant="secondary" onClick={onSubscribe} loading={loading}>
          <Link2 className="w-3.5 h-3.5 mr-1" />
          {reconnect ? 'Re-connect' : 'Subscribe'}
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" variant="secondary" onClick={onSubscribe} loading={loading}>
      <Link2 className="w-3.5 h-3.5 mr-1" />
      {reconnect ? 'Re-connect' : 'Subscribe'}
    </Button>
  );
}
