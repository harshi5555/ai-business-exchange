'use client';
import { useEffect, useState, useCallback } from 'react';
import { billingApi } from '@/lib/api';
import { Card, Badge, StatCard } from '@/components/ui/Card';
import { CreditCard, TrendingUp, FileText, CheckCircle2, Clock, AlertCircle, Package, Loader2 } from 'lucide-react';

const currentPeriod = () => new Date().toISOString().slice(0, 7);
const fmt = (n: string | number) => `$${parseFloat(String(n)).toFixed(2)}`;
const fmtNum = (n: number) => n.toLocaleString();

const statusIcon = (s: string) => ({
  paid: <CheckCircle2 className="w-4 h-4 text-green-500" />,
  issued: <Clock className="w-4 h-4 text-amber-500" />,
  overdue: <AlertCircle className="w-4 h-4 text-red-500" />,
  draft: <FileText className="w-4 h-4 text-gray-400" />,
}[s] ?? <FileText className="w-4 h-4 text-gray-400" />);

const statusVariant = (s: string): 'success' | 'warning' | 'danger' | 'default' => ({
  paid: 'success', issued: 'warning', overdue: 'danger', draft: 'default',
}[s] as 'success' | 'warning' | 'danger' | 'default' ?? 'default');

interface Plan { id: string; name: string; description: string; base_fee: string; rates: Array<{ format: string | null; direction: string | null; rate_per_message: string; included_messages: number }> }
interface PartnerBilling { plan_id: string | null; plan_name: string | null; custom_base_fee: string | null; billing_email: string | null; billing_cycle: string; status: string; trial_ends_at: string | null }
interface UsageRow { format: string; direction: string; message_count: number }
interface Invoice { id: string; period: string; base_fee: string; usage_fee: string; total: string; status: string; line_items: Array<{ format: string; count: number; included: number; billable: number; rate: number; amount: number }>; issued_at: string | null; due_at: string | null }

interface LLMUsage {
  period: string;
  platformTokens: { input: number; output: number; billedAmount: number };
  externalTokens: { input: number; output: number };
  calls: number;
}

export default function BillingPage() {
  const [billing, setBilling] = useState<PartnerBilling | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [usage, setUsage] = useState<{ period: string; rows: UsageRow[]; total: number } | null>(null);
  const [llmUsage, setLlmUsage] = useState<LLMUsage | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [period, setPeriod] = useState(currentPeriod());
  const [loading, setLoading] = useState(true);

  const [selectingPlan, setSelectingPlan] = useState<string | null>(null);
  const [planResult, setPlanResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [myRes, usageRes, llmRes, invRes] = await Promise.all([
        billingApi.getMy(), billingApi.getUsage(period), billingApi.getLLMUsage(period), billingApi.getInvoices(),
      ]);
      setBilling(myRes.data.data.billing);
      setPlans(myRes.data.data.plans);
      setUsage(usageRes.data.data);
      setLlmUsage(llmRes.data.data);
      setInvoices(invRes.data.data);
    } finally { setLoading(false); }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const handleSelectPlan = async (planId: string) => {
    setSelectingPlan(planId);
    setPlanResult(null);
    try {
      await billingApi.selectPlan(planId);
      setPlanResult({ ok: true, text: 'Plan updated successfully' });
      load();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to select plan';
      setPlanResult({ ok: false, text: msg });
    } finally {
      setSelectingPlan(null);
    }
  };

  const currentPlan = plans.find(p => p.id === billing?.plan_id);
  const effectiveBase = billing?.custom_base_fee != null
    ? parseFloat(billing.custom_base_fee) : parseFloat(currentPlan?.base_fee ?? '0');

  return (
    <div className="max-w-5xl mx-auto space-y-8">
          <div className="flex items-center gap-3">
            <CreditCard className="w-7 h-7 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
              <p className="text-sm text-gray-500">Your plan, usage, and invoices</p>
            </div>
          </div>

          {loading ? <div className="text-center py-20 text-gray-400">Loading…</div> : (
            <>
              {/* Current Plan */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard label="Current Plan" value={currentPlan?.name ?? 'No Plan'} icon={<Package className="w-5 h-5" />} color="indigo" />
                <StatCard label="Monthly Base Fee" value={fmt(effectiveBase)} icon={<CreditCard className="w-5 h-5" />} color="green" />
                <StatCard label={`Messages — ${period}`} value={fmtNum(usage?.total ?? 0)} icon={<TrendingUp className="w-5 h-5" />} color="yellow" />
              </div>

              {/* Plan + Billing Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-6 space-y-4">
                  <h2 className="font-semibold text-gray-900">Plan Details</h2>
                  {!billing ? (
                    <p className="text-sm text-gray-500">No billing plan assigned. Contact your administrator.</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-500">Status</span>
                        <Badge variant={billing.status === 'active' ? 'success' : billing.status === 'trial' ? 'warning' : 'danger'}>{billing.status}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-500">Billing cycle</span>
                        <span className="text-sm font-medium capitalize">{billing.billing_cycle}</span>
                      </div>
                      {billing.trial_ends_at && billing.status === 'trial' && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-500">Trial ends</span>
                          <span className="text-sm font-medium">{new Date(billing.trial_ends_at).toLocaleDateString()}</span>
                        </div>
                      )}
                      {billing.billing_email && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-500">Billing email</span>
                          <span className="text-sm font-medium">{billing.billing_email}</span>
                        </div>
                      )}
                      {currentPlan && (
                        <div className="mt-3 pt-3 border-t space-y-1">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rate Card</p>
                          {currentPlan.rates.map((r, i) => (
                            <div key={i} className="flex justify-between text-xs text-gray-600">
                              <span>{r.format ? r.format.toUpperCase() : 'All formats'} {r.direction ? `(${r.direction})` : ''}</span>
                              <span>${parseFloat(r.rate_per_message).toFixed(4)}/msg · {fmtNum(r.included_messages)} included</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </Card>

                {/* Usage this period */}
                <Card className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-gray-900">Usage</h2>
                    <select className="text-xs border border-gray-200 rounded px-2 py-1" value={period} onChange={e => setPeriod(e.target.value)}>
                      {Array.from({ length: 6 }, (_, i) => {
                        const d = new Date(); d.setMonth(d.getMonth() - i);
                        return d.toISOString().slice(0, 7);
                      }).map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  {!usage?.rows.length ? (
                    <p className="text-sm text-gray-400 py-4 text-center">No messages this period</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left pb-2">Format</th><th className="text-left pb-2">Direction</th><th className="text-right pb-2">Count</th></tr></thead>
                      <tbody className="divide-y">
                        {usage.rows.map((r, i) => (
                          <tr key={i}><td className="py-2 uppercase text-xs font-medium">{r.format}</td><td className="py-2 capitalize text-gray-500">{r.direction}</td><td className="py-2 text-right font-mono">{fmtNum(r.message_count)}</td></tr>
                        ))}
                        <tr className="font-semibold"><td colSpan={2} className="pt-2">Total</td><td className="pt-2 text-right font-mono">{fmtNum(usage.total)}</td></tr>
                      </tbody>
                    </table>
                  )}
                </Card>

                {/* LLM Usage */}
                {llmUsage && llmUsage.calls > 0 && (
                  <Card className="p-6 space-y-3">
                    <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />
                      AI Mapping Usage — {llmUsage.period}
                    </h2>
                    <p className="text-xs text-gray-400">{llmUsage.calls} mapping call{llmUsage.calls !== 1 ? 's' : ''} this period</p>

                    {llmUsage.platformTokens.input + llmUsage.platformTokens.output > 0 && (
                      <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-xs space-y-1">
                        <p className="font-medium text-indigo-700">Platform LLM (billed to you)</p>
                        <div className="flex justify-between text-indigo-600">
                          <span>Input tokens</span><span className="font-mono">{fmtNum(llmUsage.platformTokens.input)}</span>
                        </div>
                        <div className="flex justify-between text-indigo-600">
                          <span>Output tokens</span><span className="font-mono">{fmtNum(llmUsage.platformTokens.output)}</span>
                        </div>
                        <div className="flex justify-between font-semibold text-indigo-800 border-t border-indigo-200 pt-1 mt-1">
                          <span>LLM inference cost</span>
                          <span className="font-mono">${llmUsage.platformTokens.billedAmount.toFixed(4)}</span>
                        </div>
                      </div>
                    )}

                    {llmUsage.externalTokens.input + llmUsage.externalTokens.output > 0 && (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs space-y-1">
                        <p className="font-medium text-gray-700">Your LLM (billed to your provider) <span className="text-green-600 ml-1">$0 platform charge</span></p>
                        <div className="flex justify-between text-gray-500">
                          <span>Estimated input tokens</span><span className="font-mono">{fmtNum(llmUsage.externalTokens.input)}</span>
                        </div>
                        <div className="flex justify-between text-gray-500">
                          <span>Estimated output tokens</span><span className="font-mono">{fmtNum(llmUsage.externalTokens.output)}</span>
                        </div>
                        <p className="text-gray-400 pt-1">Check your provider's dashboard for the actual cost.</p>
                      </div>
                    )}
                  </Card>
                )}
              </div>

              {/* Invoices */}
              <Card className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-gray-500" />
                  <h2 className="font-semibold text-gray-900">Invoice History</h2>
                </div>
                {!invoices.length ? (
                  <p className="text-sm text-gray-400 py-6 text-center">No invoices yet</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-gray-500 border-b text-left"><th className="pb-2">Period</th><th className="pb-2">Base fee</th><th className="pb-2">Usage fee</th><th className="pb-2">Total</th><th className="pb-2">Due</th><th className="pb-2">Status</th></tr></thead>
                    <tbody className="divide-y">
                      {invoices.map(inv => (
                        <tr key={inv.id} className="hover:bg-gray-50">
                          <td className="py-3 font-mono text-xs">{inv.period}</td>
                          <td className="py-3">{fmt(inv.base_fee)}</td>
                          <td className="py-3">{fmt(inv.usage_fee)}</td>
                          <td className="py-3 font-semibold">{fmt(inv.total)}</td>
                          <td className="py-3 text-gray-500 text-xs">{inv.due_at ? new Date(inv.due_at).toLocaleDateString() : '—'}</td>
                          <td className="py-3"><div className="flex items-center gap-1.5">{statusIcon(inv.status)}<Badge variant={statusVariant(inv.status)}>{inv.status}</Badge></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              {/* All Plans — comparison */}
              <Card className="p-6 space-y-4">
                <h2 className="font-semibold text-gray-900">Available Plans</h2>
                {planResult && (
                  <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${planResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {planResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    {planResult.text}
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {plans.map(p => {
                    const isCurrent = p.id === billing?.plan_id;
                    const isSelecting = selectingPlan === p.id;
                    return (
                      <div key={p.id} className={`rounded-xl border p-4 space-y-2 ${isCurrent ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-gray-900">{p.name}</span>
                          {isCurrent && <Badge variant="info">Current</Badge>}
                        </div>
                        <p className="text-2xl font-bold text-gray-900">{fmt(p.base_fee)}<span className="text-sm font-normal text-gray-500">/mo</span></p>
                        <p className="text-xs text-gray-500">{p.description}</p>
                        {!isCurrent && (
                          <button
                            onClick={() => handleSelectPlan(p.id)}
                            disabled={!!selectingPlan}
                            className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium py-2 px-3 transition-colors"
                          >
                            {isSelecting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Selecting…</> : 'Select Plan'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            </>
          )}
    </div>
  );
}
