'use client';
import { useEffect, useState, useCallback } from 'react';
import { adminApi, brandingApi, mappingsApi, authApi, BrandingConfig } from '@/lib/api';
import { Card, Badge } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { statusColor } from '@/lib/utils';
import { useTheme } from '@/components/ThemeProvider';
import {
  Settings, FlaskConical, Users, CheckCircle2, XCircle,
  ToggleLeft, ToggleRight, Building2, Mail, Globe, Layers,
  Archive, Trash2, Ban, ShieldCheck, Palette, Cpu, Wifi,
  Lock, AlertCircle,
} from 'lucide-react';

interface DemoPartner {
  name: string; domain: string; email: string;
  password: string; formats: string[]; description: string;
}
interface SystemSettings { demo_mode: string; platform_name: string; auto_approve_partners: string; max_subscriptions_per_partner: string; }
interface PlatformLlmSettings {
  provider: string;
  endpoint: string;
  model: string;
  apiKeySet: boolean;
}
interface PartnerRow { id: string; name: string; contactEmail: string; domain: string; status: string; }

export default function AdminSettingsPage() {
  const { refresh: refreshTheme, platformBranding: themePlatformBranding } = useTheme();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [demoPartners, setDemoPartners] = useState<DemoPartner[]>([]);
  const [pending, setPending] = useState<PartnerRow[]>([]);
  const [allPartners, setAllPartners] = useState<PartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [demoLoading, setDemoLoading] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [localSettings, setLocalSettings] = useState<Partial<SystemSettings>>({});
  const [platformLlm, setPlatformLlm] = useState<PlatformLlmSettings>({ provider: 'azure', endpoint: '', model: '', apiKeySet: false });
  const [platformLlmApiKey, setPlatformLlmApiKey] = useState('');
  const [llmTestLoading, setLlmTestLoading] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [platformBranding, setPlatformBranding] = useState<BrandingConfig>({ primaryColor: '#6366f1', accentColor: '#4f46e5', logoUrl: '', platformName: 'BusinessX', tagline: '' });
  const [brandingLoading, setBrandingLoading] = useState(false);
  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdResult, setPwdResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Sync platform branding from ThemeProvider (already fetched on mount)
  useEffect(() => { setPlatformBranding(themePlatformBranding); }, [themePlatformBranding]);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    try {
      const [settingsRes, pendingRes, allRes] = await Promise.allSettled([
        adminApi.getSettings(),
        adminApi.listPending(),
        adminApi.listAll(),
      ]);
      if (settingsRes.status === 'fulfilled') {
        setSettings(settingsRes.value.data.data.settings);
        setLocalSettings(settingsRes.value.data.data.settings);
        setDemoPartners(settingsRes.value.data.data.demoPartners);
        setPlatformLlm(settingsRes.value.data.data.platformLlm ?? { provider: 'azure', endpoint: '', model: '', apiKeySet: false });
      }
      if (pendingRes.status === 'fulfilled') setPending(pendingRes.value.data.data);
      if (allRes.status === 'fulfilled') setAllPartners(allRes.value.data.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleDemo = async () => {
    setDemoLoading(true);
    try {
      const isOn = settings?.demo_mode === 'true';
      const res = isOn ? await adminApi.disableDemo() : await adminApi.enableDemo();
      const { added, removed } = res.data.data;
      showToast(isOn ? `Demo disabled — ${removed} partners removed` : `Demo enabled — ${added} partners added`);
      await load();
    } catch {
      showToast('Failed to toggle demo mode', false);
    } finally {
      setDemoLoading(false);
    }
  };

  const testPlatformLlm = async () => {
    setLlmTestLoading(true);
    setLlmTestResult(null);
    try {
      const res = await mappingsApi.testLlm('platform');
      if (res.data?.success) {
        const { latencyMs, model } = res.data.data;
        setLlmTestResult({ ok: true, text: `Connected — ${model} responded in ${latencyMs}ms` });
      } else {
        setLlmTestResult({ ok: false, text: res.data?.error ?? 'Connection failed' });
      }
    } catch {
      setLlmTestResult({ ok: false, text: 'Could not reach the mapping engine' });
    } finally {
      setLlmTestLoading(false);
    }
  };

  const saveSettings = async () => {
    setSettingsLoading(true);
    try {
      await adminApi.updateSettings({
        platform_name: localSettings.platform_name ?? '',
        auto_approve_partners: localSettings.auto_approve_partners ?? 'false',
        max_subscriptions_per_partner: localSettings.max_subscriptions_per_partner ?? '10',
        platform_llm_provider: platformLlm.provider,
        platform_llm_endpoint: platformLlm.endpoint,
        platform_llm_model: platformLlm.model,
        ...(platformLlmApiKey.trim() && { platform_llm_api_key: platformLlmApiKey.trim() }),
      });
      setPlatformLlmApiKey('');
      showToast('Settings saved');
      await load();
    } catch {
      showToast('Failed to save settings', false);
    } finally {
      setSettingsLoading(false);
    }
  };

  const savePlatformBranding = async () => {
    setBrandingLoading(true);
    try {
      await brandingApi.updatePlatform(platformBranding);
      await refreshTheme();
      showToast('Platform branding saved');
    } catch {
      showToast('Failed to save branding', false);
    } finally {
      setBrandingLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    try { await adminApi.approve(id); showToast('Partner approved'); await load(); }
    catch { showToast('Failed to approve', false); }
  };
  const handleReject = async (id: string) => {
    try { await adminApi.reject(id); showToast('Partner rejected'); await load(); }
    catch { showToast('Failed to reject', false); }
  };
  const handleSuspend = async (id: string) => {
    try { await adminApi.suspend(id); showToast('Partner disabled'); await load(); }
    catch { showToast('Failed to disable', false); }
  };
  const handleArchive = async (id: string) => {
    try { await adminApi.archive(id); showToast('Partner archived'); await load(); }
    catch { showToast('Failed to archive', false); }
  };
  const handleDelete = async (id: string) => {
    try { await adminApi.deletePartner(id); showToast('Partner deleted'); setConfirmDelete(null); await load(); }
    catch { showToast('Failed to delete partner', false); setConfirmDelete(null); }
  };
  const handleReactivate = async (id: string) => {
    try { await adminApi.approve(id); showToast('Partner reactivated'); await load(); }
    catch { showToast('Failed to reactivate', false); }
  };

  const demoOn = settings?.demo_mode === 'true';
  const activePartners = allPartners.filter(p => !['pending'].includes(p.status));

  const changePassword = async () => {
    setPwdResult(null);
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      setPwdResult({ ok: false, text: 'New passwords do not match' });
      return;
    }
    if (pwdForm.newPassword.length < 8) {
      setPwdResult({ ok: false, text: 'New password must be at least 8 characters' });
      return;
    }
    setPwdSaving(true);
    try {
      await authApi.changePassword(pwdForm.currentPassword, pwdForm.newPassword);
      setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwdResult({ ok: true, text: 'Password updated successfully' });
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to change password';
      setPwdResult({ ok: false, text: msg });
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">

          {/* Header */}
          <div className="flex items-center gap-3">
            <Settings className="w-7 h-7 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Admin Settings</h1>
              <p className="text-sm text-gray-500">Platform configuration and partner management</p>
            </div>
          </div>

          {/* Toast */}
          {toast && (
            <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
              {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {toast.msg}
            </div>
          )}

          {/* Delete confirm modal */}
          {confirmDelete && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full space-y-4">
                <div className="flex items-center gap-3 text-red-600">
                  <Trash2 className="w-5 h-5" />
                  <h3 className="text-base font-semibold">Delete Partner</h3>
                </div>
                <p className="text-sm text-gray-600">This will permanently delete the partner and all associated data (subscriptions, messages, schemas). This cannot be undone.</p>
                <div className="flex gap-3 justify-end">
                  <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(confirmDelete)}>Delete permanently</Button>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-20 text-gray-400">Loading…</div>
          ) : (
            <>
              {/* ─── Pending Approvals ───────────────────────────────────── */}
              <Card className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-amber-500" />
                  <h2 className="text-base font-semibold text-gray-900">Pending Approvals</h2>
                  {pending.length > 0 && (
                    <span className="ml-auto px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">{pending.length}</span>
                  )}
                </div>
                {pending.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">No pending registrations</p>
                ) : (
                  <div className="divide-y">
                    {pending.map(p => (
                      <div key={p.id} className="flex items-center justify-between py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{p.name}</p>
                          <p className="text-xs text-gray-500">{p.contactEmail} · {p.domain}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleApprove(p.id)}>Approve</Button>
                          <Button size="sm" variant="danger" onClick={() => handleReject(p.id)}>Reject</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* ─── All Partners ────────────────────────────────────────── */}
              <Card className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-indigo-500" />
                  <h2 className="text-base font-semibold text-gray-900">All Partners</h2>
                  <span className="ml-auto text-xs text-gray-400">{activePartners.length} partners</span>
                </div>
                {activePartners.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">No partners yet</p>
                ) : (
                  <div className="divide-y">
                    {activePartners.map(p => (
                      <div key={p.id} className="flex items-center justify-between py-3 gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900">{p.name}</p>
                            <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${statusColor(p.status)}`}>{p.status}</span>
                          </div>
                          <p className="text-xs text-gray-500 truncate">{p.contactEmail} · {p.domain}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {(p.status === 'suspended' || p.status === 'archived') && (
                            <button onClick={() => handleReactivate(p.id)} title="Reactivate"
                              className="p-1.5 rounded text-green-600 hover:bg-green-50 transition-colors">
                              <ShieldCheck className="w-4 h-4" />
                            </button>
                          )}
                          {p.status === 'approved' && (
                            <button onClick={() => handleSuspend(p.id)} title="Disable"
                              className="p-1.5 rounded text-orange-500 hover:bg-orange-50 transition-colors">
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                          {p.status !== 'archived' && (
                            <button onClick={() => handleArchive(p.id)} title="Archive"
                              className="p-1.5 rounded text-gray-500 hover:bg-gray-100 transition-colors">
                              <Archive className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => setConfirmDelete(p.id)} title="Delete permanently"
                            className="p-1.5 rounded text-red-500 hover:bg-red-50 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* ─── Demo Mode ──────────────────────────────────────────── */}
              <Card className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FlaskConical className="w-5 h-5 text-indigo-500" />
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Demo Mode</h2>
                      <p className="text-sm text-gray-500">Populate the platform with sample partner companies for demonstration purposes</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={demoOn ? 'success' : 'default'}>{demoOn ? 'Active' : 'Inactive'}</Badge>
                    <button
                      onClick={toggleDemo}
                      disabled={demoLoading}
                      className="focus:outline-none disabled:opacity-50"
                      title={demoOn ? 'Disable demo mode' : 'Enable demo mode'}
                    >
                      {demoOn
                        ? <ToggleRight className="w-10 h-10 text-indigo-600" />
                        : <ToggleLeft className="w-10 h-10 text-gray-400" />}
                    </button>
                  </div>
                </div>

                {/* Demo partner list */}
                <div className="border-t pt-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Demo Partners ({demoPartners.length}) — all login with password: <code className="bg-gray-100 px-1 rounded">Demo@1234</code>
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {demoPartners.map(p => (
                      <div key={p.domain} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
                        <Building2 className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{p.name}</p>
                          <p className="text-xs text-gray-500 truncate">{p.description}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="flex items-center gap-1 text-xs text-gray-400"><Globe className="w-3 h-3" />{p.domain}</span>
                            <span className="flex items-center gap-1 text-xs text-gray-400"><Mail className="w-3 h-3" />{p.email}</span>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {p.formats.map(f => (
                              <span key={f} className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
                                {f.toUpperCase()}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

              {/* ─── Platform Settings ───────────────────────────────────── */}
              <Card className="p-6 space-y-5">
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-gray-500" />
                  <h2 className="text-base font-semibold text-gray-900">Platform Settings</h2>
                </div>

                <Input
                  label="Platform name"
                  value={localSettings.platform_name ?? ''}
                  onChange={e => setLocalSettings(s => ({ ...s, platform_name: e.target.value }))}
                  placeholder="BusinessX"
                />

                <Input
                  label="Max subscriptions per partner"
                  type="number"
                  value={localSettings.max_subscriptions_per_partner ?? '10'}
                  onChange={e => setLocalSettings(s => ({ ...s, max_subscriptions_per_partner: e.target.value }))}
                />

                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Auto-approve new partners</p>
                    <p className="text-xs text-gray-500">Skip manual review for new partner registrations</p>
                  </div>
                  <button
                    onClick={() => setLocalSettings(s => ({ ...s, auto_approve_partners: s.auto_approve_partners === 'true' ? 'false' : 'true' }))}
                    className="focus:outline-none"
                  >
                    {localSettings.auto_approve_partners === 'true'
                      ? <ToggleRight className="w-9 h-9 text-indigo-600" />
                      : <ToggleLeft className="w-9 h-9 text-gray-400" />}
                  </button>
                </div>

                <div className="flex justify-end">
                  <Button onClick={saveSettings} loading={settingsLoading}>Save settings</Button>
                </div>
              </Card>

              <Card className="p-6 space-y-5">
                <div className="flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-indigo-500" />
                  <h2 className="text-base font-semibold text-gray-900">Platform Default LLM</h2>
                </div>
                <p className="text-sm text-gray-500">
                  This is the application-wide default used whenever a partner does not override the LLM in their own settings.
                </p>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Provider</label>
                  <select
                    value={platformLlm.provider}
                    onChange={e => setPlatformLlm(s => ({ ...s, provider: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    <option value="azure">Azure OpenAI</option>
                    <option value="openai">OpenAI</option>
                    <option value="openai-compatible">OpenAI-compatible</option>
                  </select>
                </div>

                {(platformLlm.provider === 'azure' || platformLlm.provider === 'openai-compatible') && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">
                      {platformLlm.provider === 'azure' ? 'Endpoint URL' : 'Base URL'}
                    </label>
                    <input
                      type="text"
                      value={platformLlm.endpoint}
                      onChange={e => setPlatformLlm(s => ({ ...s, endpoint: e.target.value }))}
                      placeholder={platformLlm.provider === 'azure' ? 'https://my-org.openai.azure.com/' : 'http://localhost:1234'}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    {platformLlm.provider === 'azure' ? 'Deployment Name' : 'Model Name'}
                  </label>
                  <input
                    type="text"
                    value={platformLlm.model}
                    onChange={e => setPlatformLlm(s => ({ ...s, model: e.target.value }))}
                    placeholder={platformLlm.provider === 'azure' ? 'gpt-4o-mini' : 'gpt-4o-mini'}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    API Key {platformLlm.apiKeySet && <span className="text-green-600 ml-1">✓ key stored</span>}
                  </label>
                  <input
                    type="password"
                    value={platformLlmApiKey}
                    onChange={e => setPlatformLlmApiKey(e.target.value)}
                    placeholder={platformLlm.apiKeySet ? '••••••••  (leave blank to keep existing)' : 'sk-...'}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">Stored encrypted in application settings and used as the platform default.</p>
                </div>

                <div className="flex justify-end gap-2">
                  {platformLlm.apiKeySet && (
                    <Button variant="secondary" onClick={testPlatformLlm} loading={llmTestLoading}>
                      <Wifi className="w-3.5 h-3.5 mr-1.5" />Test connection
                    </Button>
                  )}
                  <Button onClick={saveSettings} loading={settingsLoading}>Save platform LLM</Button>
                </div>
                {llmTestResult && (
                  <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${llmTestResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {llmTestResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                    {llmTestResult.text}
                  </div>
                )}
              </Card>

              {/* Platform Branding */}
              <Card>
                <div className="flex items-start gap-3 mb-4">
                  <Palette className="w-5 h-5 text-indigo-500 mt-0.5 shrink-0" />
                  <div>
                    <h2 className="text-sm font-semibold text-gray-700">Platform Branding</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      White-label this platform with your company name, logo, and brand colors. Changes appear on the login page, sidebar, and browser tab.
                    </p>
                  </div>
                </div>

                {/* Identity */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Platform Name</label>
                    <input
                      type="text"
                      value={platformBranding.platformName || ''}
                      onChange={e => setPlatformBranding(b => ({ ...b, platformName: e.target.value }))}
                      placeholder="BusinessX"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Tagline</label>
                    <input
                      type="text"
                      value={platformBranding.tagline || ''}
                      onChange={e => setPlatformBranding(b => ({ ...b, tagline: e.target.value }))}
                      placeholder="B2B Integration Platform"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>

                {/* Logo */}
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Logo</label>
                  <div className="flex items-start gap-3">
                    {/* Preview */}
                    <div className="w-12 h-12 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0"
                         style={{ backgroundColor: platformBranding.primaryColor || '#6366f1' }}>
                      {platformBranding.logoUrl
                        ? <img src={platformBranding.logoUrl} alt="logo preview" className="w-full h-full object-contain p-1" />
                        : <span className="text-white font-bold text-lg">
                            {(platformBranding.platformName || 'B')[0].toUpperCase()}
                          </span>}
                    </div>
                    <div className="flex-1 space-y-2">
                      <input
                        type="url"
                        value={platformBranding.logoUrl?.startsWith('data:') ? '' : (platformBranding.logoUrl || '')}
                        onChange={e => setPlatformBranding(b => ({ ...b, logoUrl: e.target.value }))}
                        placeholder="https://your-company.com/logo.png"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                      />
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>or</span>
                        <label className="cursor-pointer text-indigo-600 hover:underline">
                          upload file
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = ev => setPlatformBranding(b => ({ ...b, logoUrl: ev.target?.result as string }));
                              reader.readAsDataURL(file);
                            }}
                          />
                        </label>
                        {platformBranding.logoUrl && (
                          <button onClick={() => setPlatformBranding(b => ({ ...b, logoUrl: '' }))} className="text-red-400 hover:text-red-600 ml-auto">clear</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Colors */}
                <div className="grid grid-cols-2 gap-6 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Primary Color</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={platformBranding.primaryColor || '#6366f1'}
                        onChange={e => setPlatformBranding(b => ({ ...b, primaryColor: e.target.value }))}
                        className="h-10 w-14 rounded-lg border border-gray-300 cursor-pointer p-0.5"
                      />
                      <input
                        type="text"
                        value={platformBranding.primaryColor || ''}
                        onChange={e => setPlatformBranding(b => ({ ...b, primaryColor: e.target.value }))}
                        placeholder="#6366f1"
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Accent Color</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={platformBranding.accentColor || '#4f46e5'}
                        onChange={e => setPlatformBranding(b => ({ ...b, accentColor: e.target.value }))}
                        className="h-10 w-14 rounded-lg border border-gray-300 cursor-pointer p-0.5"
                      />
                      <input
                        type="text"
                        value={platformBranding.accentColor || ''}
                        onChange={e => setPlatformBranding(b => ({ ...b, accentColor: e.target.value }))}
                        placeholder="#4f46e5"
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setPlatformBranding({ primaryColor: '#6366f1', accentColor: '#4f46e5', logoUrl: '', platformName: 'BusinessX', tagline: '' })}
                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                  >
                    Reset to defaults
                  </button>
                  <Button onClick={savePlatformBranding} loading={brandingLoading}>Save Branding</Button>
                </div>
              </Card>

              {/* ─── Change Password ──────────────────────────────────────── */}
              <Card>
                <div className="flex items-start gap-3 mb-4">
                  <Lock className="w-5 h-5 text-indigo-500 mt-0.5 shrink-0" />
                  <div>
                    <h2 className="text-sm font-semibold text-gray-700">Change Password</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Update the admin account login password. Must be at least 8 characters.</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Current Password</label>
                    <input
                      type="password"
                      value={pwdForm.currentPassword}
                      onChange={e => setPwdForm(f => ({ ...f, currentPassword: e.target.value }))}
                      autoComplete="current-password"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">New Password</label>
                    <input
                      type="password"
                      value={pwdForm.newPassword}
                      onChange={e => setPwdForm(f => ({ ...f, newPassword: e.target.value }))}
                      autoComplete="new-password"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Confirm New Password</label>
                    <input
                      type="password"
                      value={pwdForm.confirmPassword}
                      onChange={e => setPwdForm(f => ({ ...f, confirmPassword: e.target.value }))}
                      autoComplete="new-password"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>

                {pwdResult && (
                  <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm mt-4 ${pwdResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {pwdResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    {pwdResult.text}
                  </div>
                )}

                <div className="flex justify-end mt-4">
                  <Button
                    onClick={changePassword}
                    loading={pwdSaving}
                    disabled={!pwdForm.currentPassword || !pwdForm.newPassword || !pwdForm.confirmPassword}
                  >
                    Change Password
                  </Button>
                </div>
              </Card>
            </>
          )}
        </div>
  );
}
