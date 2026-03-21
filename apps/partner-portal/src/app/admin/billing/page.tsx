'use client';
import { Fragment, useEffect, useState, useCallback } from 'react';
import { billingApi } from '@/lib/api';
import { Card, Badge } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DollarSign, Users, FileText, Plus, Edit2, CheckCircle2, Clock, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

const currentPeriod = () => new Date().toISOString().slice(0, 7);
const fmt = (n: string | number) => `$${parseFloat(String(n)).toFixed(2)}`;
const fmtNum = (n: number) => n.toLocaleString();

interface Rate { format: string | null; direction: string | null; rate_per_message: string; included_messages: number }
interface Plan { id: string; name: string; description: string; base_fee: string; is_active: boolean; rates: Rate[] }
interface PartnerBillingRow { partner_id: string; partner_name: string; plan_id: string | null; plan_name: string | null; custom_base_fee: string | null; status: string | null; billing_cycle: string | null }
interface UsageRow { partner_id: string; partner_name: string; period: string; total: number; by_format: Array<{ format: string; direction: string; message_count: number }> }
interface Invoice { id: string; period: string; partner_name: string; base_fee: string; usage_fee: string; total: string; status: string; issued_at: string | null; due_at: string | null }

const FORMATS = ['json', 'xml', 'csv', 'edi-x12', 'edifact'];

export default function AdminBillingPage() {
  const [tab, setTab] = useState<'plans' | 'partners' | 'usage' | 'invoices'>('plans');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [partners, setPartners] = useState<PartnerBillingRow[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [period, setPeriod] = useState(currentPeriod());
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Plan editor state
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [newPlan, setNewPlan] = useState({ name: '', description: '', base_fee: '0', rates: FORMATS.map(f => ({ format: f, direction: null, rate_per_message: '0.005', included_messages: 1000 })) });

  // Partner assignment state
  const [editingPartner, setEditingPartner] = useState<string | null>(null);
  const [partnerForm, setPartnerForm] = useState<{ plan_id: string; custom_base_fee: string; billing_email: string; status: string }>({ plan_id: '', custom_base_fee: '', billing_email: '', status: 'active' });

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'plans') { const r = await billingApi.adminGetPlans(); setPlans(r.data.data); }
      if (tab === 'partners') { const [pr, pl] = await Promise.all([billingApi.adminGetPartners(), billingApi.adminGetPlans()]); setPartners(pr.data.data); setPlans(pl.data.data); }
      if (tab === 'usage') { const r = await billingApi.adminGetUsage(period); setUsage(r.data.data); }
      if (tab === 'invoices') { const r = await billingApi.adminGetInvoices(period); setInvoices(r.data.data); }
    } finally { setLoading(false); }
  }, [tab, period]);

  useEffect(() => { load(); }, [load]);

  const savePlan = async () => {
    try {
      await billingApi.adminCreatePlan({ name: newPlan.name, description: newPlan.description, base_fee: parseFloat(newPlan.base_fee), rates: newPlan.rates.map(r => ({ ...r, rate_per_message: parseFloat(r.rate_per_message) })) });
      showToast('Plan created'); setShowNewPlan(false); load();
    } catch { showToast('Failed to create plan', false); }
  };

  const saveRates = async (plan: Plan) => {
    try {
      await billingApi.adminUpdateRates(plan.id, plan.rates.map(r => ({ ...r, rate_per_message: parseFloat(r.rate_per_message as unknown as string) })));
      await billingApi.adminUpdatePlan(plan.id, { name: plan.name, description: plan.description, base_fee: parseFloat(plan.base_fee) });
      showToast('Plan saved'); setEditingPlan(null); load();
    } catch { showToast('Failed to save', false); }
  };

  const assignPlan = async (partnerId: string) => {
    try {
      await billingApi.adminAssignPlan(partnerId, {
        plan_id: partnerForm.plan_id || undefined,
        custom_base_fee: partnerForm.custom_base_fee ? parseFloat(partnerForm.custom_base_fee) : null,
        billing_email: partnerForm.billing_email || undefined,
        status: partnerForm.status,
      });
      showToast('Billing updated'); setEditingPartner(null); load();
    } catch { showToast('Failed', false); }
  };

  const generateInvoices = async () => {
    try {
      const r = await billingApi.adminGenerateInvoices(period);
      showToast(`Generated ${r.data.data.generated} invoices for ${period}`); load();
    } catch { showToast('Failed to generate invoices', false); }
  };

  const markPaid = async (id: string) => {
    try { await billingApi.adminMarkPaid(id); showToast('Marked as paid'); load(); }
    catch { showToast('Failed', false); }
  };

  const tabs = [
    { id: 'plans', label: 'Plans & Rates', icon: DollarSign },
    { id: 'partners', label: 'Partner Billing', icon: Users },
    { id: 'usage', label: 'Usage', icon: ChevronUp },
    { id: 'invoices', label: 'Invoices', icon: FileText },
  ] as const;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <DollarSign className="w-7 h-7 text-indigo-600" />
            <div><h1 className="text-2xl font-bold text-gray-900">Billing Admin</h1><p className="text-sm text-gray-500">Manage plans, rates, partner assignments, usage and invoices</p></div>
          </div>

          {toast && (
            <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
              {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}{toast.msg}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-gray-200">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                <t.icon className="w-4 h-4" />{t.label}
              </button>
            ))}
          </div>

          {loading && <div className="text-center py-10 text-gray-400">Loading…</div>}

          {/* ─── Plans & Rates ─── */}
          {!loading && tab === 'plans' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button onClick={() => setShowNewPlan(v => !v)} variant="secondary">
                  <Plus className="w-4 h-4 mr-1" />New Plan
                </Button>
              </div>

              {showNewPlan && (
                <Card className="p-6 space-y-4 border-indigo-200">
                  <h3 className="font-semibold text-gray-900">Create New Plan</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Plan name" value={newPlan.name} onChange={e => setNewPlan(p => ({ ...p, name: e.target.value }))} placeholder="Enterprise Plus" />
                    <Input label="Monthly base fee ($)" type="number" value={newPlan.base_fee} onChange={e => setNewPlan(p => ({ ...p, base_fee: e.target.value }))} />
                  </div>
                  <Input label="Description" value={newPlan.description} onChange={e => setNewPlan(p => ({ ...p, description: e.target.value }))} />
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rates per format</p>
                  <div className="space-y-2">
                    {newPlan.rates.map((r, i) => (
                      <div key={r.format} className="flex items-center gap-3">
                        <span className="w-16 text-xs font-mono uppercase text-gray-600">{r.format}</span>
                        <Input label="" placeholder="Rate/msg" type="number" step="0.0001" value={r.rate_per_message} onChange={e => setNewPlan(p => { const rates = [...p.rates]; rates[i] = { ...rates[i], rate_per_message: e.target.value }; return { ...p, rates }; })} />
                        <Input label="" placeholder="Included" type="number" value={r.included_messages} onChange={e => setNewPlan(p => { const rates = [...p.rates]; rates[i] = { ...rates[i], included_messages: parseInt(e.target.value) }; return { ...p, rates }; })} />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="secondary" onClick={() => setShowNewPlan(false)}>Cancel</Button>
                    <Button onClick={savePlan}>Create Plan</Button>
                  </div>
                </Card>
              )}

              {plans.map(plan => (
                <Card key={plan.id} className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2"><h3 className="font-semibold text-gray-900">{plan.name}</h3><Badge variant={plan.is_active ? 'success' : 'default'}>{plan.is_active ? 'Active' : 'Inactive'}</Badge></div>
                      <p className="text-sm text-gray-500">{plan.description}</p>
                      <p className="text-xl font-bold text-gray-900 mt-1">{fmt(plan.base_fee)}<span className="text-sm font-normal text-gray-500">/month</span></p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setEditingPlan(editingPlan?.id === plan.id ? null : { ...plan, rates: plan.rates.map(r => ({ ...r })) })}>
                      <Edit2 className="w-3.5 h-3.5 mr-1" />{editingPlan?.id === plan.id ? 'Close' : 'Edit'}
                    </Button>
                  </div>

                  {editingPlan?.id === plan.id ? (
                    <div className="space-y-3 border-t pt-4">
                      <div className="grid grid-cols-2 gap-4">
                        <Input label="Plan name" value={editingPlan.name} onChange={e => setEditingPlan(p => p ? { ...p, name: e.target.value } : p)} />
                        <Input label="Base fee ($)" type="number" value={editingPlan.base_fee} onChange={e => setEditingPlan(p => p ? { ...p, base_fee: e.target.value } : p)} />
                      </div>
                      <Input label="Description" value={editingPlan.description} onChange={e => setEditingPlan(p => p ? { ...p, description: e.target.value } : p)} />
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-2">Rates</p>
                      <table className="w-full text-sm">
                        <thead><tr className="text-xs text-gray-500"><th className="text-left pb-1">Format</th><th className="text-left pb-1">Direction</th><th className="text-left pb-1">Rate/msg ($)</th><th className="text-left pb-1">Included</th></tr></thead>
                        <tbody className="space-y-1">
                          {editingPlan.rates.map((r, i) => (
                            <tr key={i}>
                              <td className="pr-2 py-1"><span className="uppercase text-xs font-mono">{r.format ?? 'All'}</span></td>
                              <td className="pr-2 py-1"><span className="text-xs text-gray-500">{r.direction ?? 'Both'}</span></td>
                              <td className="pr-2 py-1"><input type="number" step="0.0001" className="border rounded px-2 py-1 text-xs w-24" value={r.rate_per_message} onChange={e => setEditingPlan(p => { if (!p) return p; const rates = [...p.rates]; rates[i] = { ...rates[i], rate_per_message: e.target.value }; return { ...p, rates }; })} /></td>
                              <td className="py-1"><input type="number" className="border rounded px-2 py-1 text-xs w-24" value={r.included_messages} onChange={e => setEditingPlan(p => { if (!p) return p; const rates = [...p.rates]; rates[i] = { ...rates[i], included_messages: parseInt(e.target.value) }; return { ...p, rates }; })} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex gap-2 justify-end">
                        <Button variant="secondary" onClick={() => setEditingPlan(null)}>Cancel</Button>
                        <Button onClick={() => saveRates(editingPlan)}>Save Plan</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="border-t pt-3">
                      <table className="w-full text-xs text-gray-600">
                        <thead><tr className="text-gray-400"><th className="text-left pb-1">Format</th><th className="text-left pb-1">Rate/msg</th><th className="text-left pb-1">Included msgs</th></tr></thead>
                        <tbody>{plan.rates.map((r, i) => (<tr key={i}><td className="py-0.5 uppercase font-mono">{r.format ?? 'All'}</td><td className="py-0.5">${parseFloat(r.rate_per_message).toFixed(4)}</td><td className="py-0.5">{fmtNum(r.included_messages)}</td></tr>))}</tbody>
                      </table>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}

          {/* ─── Partner Billing ─── */}
          {!loading && tab === 'partners' && (
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b"><tr className="text-xs text-gray-500 uppercase tracking-wide"><th className="text-left px-6 py-3">Partner</th><th className="text-left px-4 py-3">Plan</th><th className="text-left px-4 py-3">Custom fee</th><th className="text-left px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
                <tbody className="divide-y">
                  {partners.map(p => (
                    <Fragment key={p.partner_id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-6 py-3 font-medium">{p.partner_name}</td>
                        <td className="px-4 py-3 text-gray-500">{p.plan_name ?? <span className="italic text-gray-300">None</span>}</td>
                        <td className="px-4 py-3">{p.custom_base_fee ? fmt(p.custom_base_fee) : '—'}</td>
                        <td className="px-4 py-3"><Badge variant={p.status === 'active' ? 'success' : p.status === 'trial' ? 'warning' : 'default'}>{p.status ?? 'unassigned'}</Badge></td>
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" variant="secondary" onClick={() => { setEditingPartner(editingPartner === p.partner_id ? null : p.partner_id); setPartnerForm({ plan_id: p.plan_id ?? '', custom_base_fee: p.custom_base_fee ?? '', billing_email: '', status: p.status ?? 'active' }); }}>
                            {editingPartner === p.partner_id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </Button>
                        </td>
                      </tr>
                      {editingPartner === p.partner_id && (
                        <tr><td colSpan={5} className="px-6 py-4 bg-indigo-50">
                          <div className="grid grid-cols-4 gap-3">
                            <div>
                              <label className="text-xs font-medium text-gray-600 block mb-1">Plan</label>
                              <select className="w-full border rounded px-2 py-1.5 text-sm" value={partnerForm.plan_id} onChange={e => setPartnerForm(f => ({ ...f, plan_id: e.target.value }))}>
                                <option value="">No plan</option>
                                {plans.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
                              </select>
                            </div>
                            <Input label="Custom base fee ($)" type="number" value={partnerForm.custom_base_fee} onChange={e => setPartnerForm(f => ({ ...f, custom_base_fee: e.target.value }))} placeholder="Override plan fee" />
                            <Input label="Billing email" type="email" value={partnerForm.billing_email} onChange={e => setPartnerForm(f => ({ ...f, billing_email: e.target.value }))} />
                            <div>
                              <label className="text-xs font-medium text-gray-600 block mb-1">Status</label>
                              <select className="w-full border rounded px-2 py-1.5 text-sm" value={partnerForm.status} onChange={e => setPartnerForm(f => ({ ...f, status: e.target.value }))}>
                                {['trial', 'active', 'suspended'].map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end mt-3">
                            <Button size="sm" variant="secondary" onClick={() => setEditingPartner(null)}>Cancel</Button>
                            <Button size="sm" onClick={() => assignPlan(p.partner_id)}>Save</Button>
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* ─── Usage ─── */}
          {!loading && tab === 'usage' && (
            <div className="space-y-4">
              <div className="flex gap-2 items-center">
                <select className="border border-gray-200 rounded px-3 py-1.5 text-sm" value={period} onChange={e => setPeriod(e.target.value)}>
                  {Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 7); }).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <Card className="p-0 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b"><tr className="text-xs text-gray-500 uppercase"><th className="text-left px-6 py-3">Partner</th><th className="text-left px-4 py-3">Format breakdown</th><th className="text-right px-6 py-3">Total msgs</th></tr></thead>
                  <tbody className="divide-y">
                    {usage.length === 0 && <tr><td colSpan={3} className="text-center py-8 text-gray-400">No usage data for {period}</td></tr>}
                    {usage.map(u => (
                      <tr key={u.partner_id} className="hover:bg-gray-50">
                        <td className="px-6 py-3 font-medium">{u.partner_name}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {u.by_format.map((f, i) => <span key={i} className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600">{f.format.toUpperCase()} {fmtNum(f.message_count)}</span>)}
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right font-mono font-semibold">{fmtNum(u.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}

          {/* ─── Invoices ─── */}
          {!loading && tab === 'invoices' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <select className="border border-gray-200 rounded px-3 py-1.5 text-sm" value={period} onChange={e => setPeriod(e.target.value)}>
                  {Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 7); }).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <Button onClick={generateInvoices}><FileText className="w-4 h-4 mr-1" />Generate invoices for {period}</Button>
              </div>
              <Card className="p-0 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b"><tr className="text-xs text-gray-500 uppercase"><th className="text-left px-6 py-3">Partner</th><th className="text-left px-4 py-3">Period</th><th className="text-right px-4 py-3">Base</th><th className="text-right px-4 py-3">Usage</th><th className="text-right px-4 py-3">Total</th><th className="text-left px-4 py-3">Due</th><th className="text-left px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
                  <tbody className="divide-y">
                    {invoices.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-400">No invoices for {period}</td></tr>}
                    {invoices.map(inv => (
                      <tr key={inv.id} className="hover:bg-gray-50">
                        <td className="px-6 py-3 font-medium">{inv.partner_name}</td>
                        <td className="px-4 py-3 font-mono text-xs">{inv.period}</td>
                        <td className="px-4 py-3 text-right">{fmt(inv.base_fee)}</td>
                        <td className="px-4 py-3 text-right">{fmt(inv.usage_fee)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{fmt(inv.total)}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{inv.due_at ? new Date(inv.due_at).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {inv.status === 'paid' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : inv.status === 'overdue' ? <AlertCircle className="w-4 h-4 text-red-500" /> : <Clock className="w-4 h-4 text-amber-500" />}
                            <Badge variant={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : 'warning'}>{inv.status}</Badge>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {inv.status !== 'paid' && <Button size="sm" variant="secondary" onClick={() => markPaid(inv.id)}>Mark paid</Button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </div>
  );
}
