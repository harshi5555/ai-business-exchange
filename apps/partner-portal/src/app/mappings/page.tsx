'use client';
import { useEffect, useState, useCallback } from 'react';
import { mappingsApi, subscriptionsApi, integrationsApi } from '@/lib/api';
import {
  FORMAT_FALLBACK_SAMPLES,
  PORTAL_FORMATS,
  STANDARD_SCHEMA_MESSAGE_TYPES,
  getSchemaSamplePayload,
} from '@/lib/schema-sample-payloads';
import { Badge, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { statusColor, fmtDateTime, cn, getPartnerId } from '@/lib/utils';
import {
  Cpu, CheckCircle, Sparkles, Plus, Trash2, Save,
  ChevronDown, ChevronUp, Zap, ZapOff, GitBranch, AlertTriangle, BookOpen, Copy, Check, Tag,
  ArrowRight, ArrowLeft, FlaskConical, Info, SendHorizonal, CheckCircle2, XCircle, Clock, ShieldCheck,
} from 'lucide-react';

const CDM_GROUPS: Record<string, string[]> = {
  envelope: ['id', 'type', 'timestamp'],
  sender: ['sender.id', 'sender.name', 'sender.email'],
  receiver: ['receiver.id', 'receiver.name'],
  order: ['order.id', 'order.date', 'order.total', 'order.currency', 'order.lineItems[].id', 'order.lineItems[].sku', 'order.lineItems[].quantity', 'order.lineItems[].price'],
  invoice: ['invoice.id', 'invoice.date', 'invoice.dueDate', 'invoice.amount'],
  shipment: ['shipment.id', 'shipment.trackingNumber', 'shipment.carrier', 'shipment.status'],
  product: ['product.id', 'product.sku', 'product.name', 'product.price'],
  address: ['address.street', 'address.city', 'address.state', 'address.zip', 'address.country'],
};
const CDM_FIELDS = Object.values(CDM_GROUPS).flat();

interface MappingRule { sourceField: string; targetField: string; confidence: number; transform?: string }
interface Schema {
  id: string; partnerId: string; format: string; messageType: string; status: string;
  isActive: boolean; mappingRules: MappingRule[]; version: number; createdAt: string;
  schemaDirection?: 'outbound' | 'inbound';
  createdWithModel?: string;
}
interface SendTarget { partnerId: string; companyName: string }
interface LlmStageTrace {
  stage: 1 | 2;
  label: string;
  model: string;
  prompt: string;
  response: string;
  inputTokens: number;
  outputTokens: number;
}
interface TransformResult {
  mappedPayload: string;
  cdmPayload: string;
  rulesApplied: number;
  outputFormat: string;
  schemaId?: string;
  llmContext?: { stages: LlmStageTrace[] };
}

// ─── Confidence badge ─────────────────────────────────────────────────────────
function ConfidenceDot({ confidence }: { confidence: number }) {
  if (confidence >= 0.85) return <span className="text-green-500" title="≥85% auto-approved">●</span>;
  if (confidence >= 0.70) return <span className="text-amber-500" title="70–84% review recommended">▲</span>;
  return <span className="text-red-500" title="<70% low confidence">●</span>;
}

// ─── CDM Reference Panel ──────────────────────────────────────────────────────
function CdmReference() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copyField = (f: string) => {
    navigator.clipboard.writeText(f).then(() => { setCopied(f); setTimeout(() => setCopied(null), 1200); });
  };
  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-indigo-50 transition-colors">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-indigo-500" />
          <span className="font-semibold text-sm text-indigo-800">CDM Reference — Canonical Data Model</span>
          <span className="text-xs text-indigo-500 bg-indigo-100 rounded-full px-2 py-0.5">{CDM_FIELDS.length} fields</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-indigo-400" /> : <ChevronDown className="w-4 h-4 text-indigo-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-indigo-100">
          <p className="text-xs text-indigo-600 mt-3 mb-3">
            These are the platform-standard CDM target fields. Map your source fields to these when registering schemas. Click any field to copy it.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(CDM_GROUPS).map(([group, fields]) => (
              <div key={group} className="bg-white rounded-lg border border-indigo-100 p-3">
                <div className="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-2">{group}</div>
                <div className="space-y-1">
                  {fields.map(f => (
                    <button key={f} onClick={() => copyField(f)}
                      className="flex items-center gap-1.5 w-full text-left group hover:text-indigo-700 transition-colors">
                      {copied === f
                        ? <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                        : <Copy className="w-3 h-3 text-gray-300 group-hover:text-indigo-400 flex-shrink-0" />}
                      <span className="font-mono text-xs text-gray-600 group-hover:text-indigo-700">{f}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inline editable rules table ─────────────────────────────────────────────
function RulesEditor({ rules, onChange }: { rules: MappingRule[]; onChange: (r: MappingRule[]) => void }) {
  const update = (i: number, field: keyof MappingRule, value: string) =>
    onChange(rules.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  const remove = (i: number) => onChange(rules.filter((_, idx) => idx !== i));
  const add = () => onChange([...rules, { sourceField: '', targetField: '', confidence: 1, transform: '' }]);

  return (
    <div className="space-y-2">
      <datalist id="cdm-fields">{CDM_FIELDS.map(f => <option key={f} value={f} />)}</datalist>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              {['Source Field', '→ CDM Field', 'Transform (optional)', 'Conf.', ''].map(h => (
                <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rules.map((r, i) => {
              const conf = r.confidence ?? 0;
              const rowBg = conf >= 0.85 ? 'bg-white' : conf >= 0.70 ? 'bg-amber-50' : 'bg-red-50';
              return (
                <tr key={i} className={cn(rowBg, 'hover:brightness-95 transition-all')}>
                  <td className="px-2 py-1.5">
                    <input value={r.sourceField} onChange={e => update(i, 'sourceField', e.target.value)}
                      className="w-full font-mono text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none px-1 py-0.5" placeholder="source.field" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={r.targetField} onChange={e => update(i, 'targetField', e.target.value)}
                      list="cdm-fields" className="w-full font-mono text-indigo-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none px-1 py-0.5" placeholder="cdm.field" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={r.transform ?? ''} onChange={e => update(i, 'transform', e.target.value)}
                      className="w-full font-mono text-gray-500 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-gray-400 focus:outline-none px-1 py-0.5" placeholder="e.g. value.toUpperCase()" />
                  </td>
                  <td className="px-2 py-1.5 w-28">
                    <div className="flex items-center gap-1.5">
                      <div className="w-10 bg-gray-200 rounded-full h-1.5">
                        <div
                          className={cn('h-1.5 rounded-full', conf >= 0.85 ? 'bg-green-500' : conf >= 0.70 ? 'bg-amber-400' : 'bg-red-500')}
                          style={{ width: `${conf * 100}%` }}
                        />
                      </div>
                      <span className="text-gray-500">{Math.round(conf * 100)}%</span>
                      <ConfidenceDot confidence={conf} />
                    </div>
                  </td>
                  <td className="px-2 py-1.5 w-8">
                    <button onClick={() => remove(i)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {rules.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">No rules yet — add one below.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-1">
        <button onClick={add} className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-medium py-1">
          <Plus className="w-3.5 h-3.5" /> Add rule
        </button>
        <span className="text-xs text-gray-400 select-none">
          <span className="text-green-500">●</span> ≥85% auto-approved &nbsp;
          <span className="text-amber-500">▲</span> 70–84% review recommended &nbsp;
          <span className="text-red-500">●</span> &lt;70% low confidence
        </span>
      </div>
    </div>
  );
}

// ─── Format pipeline pill row ─────────────────────────────────────────────────
function FormatPipeline({ sourceFormat }: { sourceFormat: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="font-mono bg-gray-100 border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
        {sourceFormat.toUpperCase()}
      </span>
      <ArrowRight className="w-3 h-3 text-gray-400" />
      <span className="font-mono bg-indigo-50 border border-indigo-200 text-indigo-600 px-1.5 py-0.5 rounded">
        CDM
      </span>
    </span>
  );
}

// ─── Single version row inside a message-type/format group ───────────────────
function VersionRow({
  schema, isExpanded, editingRules, onToggle, onRulesChange, onSave, onActivate, onApprove, onDelete, saving,
}: {
  schema: Schema; isExpanded: boolean; editingRules: MappingRule[] | null;
  onToggle: () => void; onRulesChange: (r: MappingRule[]) => void;
  onSave: () => void; onActivate: () => void; onApprove: () => void; onDelete: () => void; saving: boolean;
}) {
  const isPendingReview = schema.status === 'pending_review';
  const isApproved = schema.status === 'auto_approved' || schema.status === 'approved';
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isInbound = schema.schemaDirection === 'inbound';
  const directionAccent = isInbound ? 'purple' : 'teal';

  return (
    <div
      className={cn(
        'border-b border-gray-100 last:border-0',
        schema.isActive && (isInbound ? 'bg-purple-50/40' : 'bg-teal-50/40')
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-5 flex-shrink-0">
          {schema.isActive ? <Zap className={cn('w-4 h-4', isInbound ? 'text-purple-500' : 'text-teal-500')} /> : <div className="w-4 h-4" />}
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          <span className={cn('font-semibold text-sm', schema.isActive ? (isInbound ? 'text-purple-700' : 'text-teal-700') : 'text-gray-600')}>
            v{schema.version}
          </span>
          <FormatPipeline sourceFormat={schema.format} />
          {schema.isActive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 text-indigo-700 px-2 py-0.5 text-xs font-semibold">
              <Zap className="w-3 h-3" />ACTIVE
            </span>
          )}
          <Badge label={schema.status} className={statusColor(schema.status)} />
          {schema.schemaDirection === 'inbound'
            ? <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-xs font-semibold"><ArrowLeft className="w-3 h-3" />INBOUND</span>
            : <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 text-teal-700 px-2 py-0.5 text-xs font-semibold"><ArrowRight className="w-3 h-3" />OUTBOUND</span>
          }
        </div>
        <div className="hidden sm:flex flex-col items-end gap-1 text-right">
          <span className="text-xs text-gray-400">{schema.mappingRules.length} rules · {fmtDateTime(schema.createdAt)}</span>
          {schema.createdWithModel && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 text-xs font-medium">
              <Cpu className="w-3 h-3" />
              {schema.createdWithModel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!schema.isActive && isApproved && (
            <Button size="sm" variant="secondary" onClick={onActivate}>
              <Zap className="w-3 h-3 mr-1" />Set Active
            </Button>
          )}
          {isPendingReview && (
            <Button size="sm" onClick={onApprove}>
              <CheckCircle className="w-3 h-3 mr-1" />Approve
            </Button>
          )}
          <button onClick={onToggle}
            className={cn(
              'flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-white transition-colors',
              isInbound ? 'text-gray-500 hover:text-purple-600' : 'text-gray-500 hover:text-teal-600'
            )}>
            {isExpanded ? <><ChevronUp className="w-3.5 h-3.5" />Hide</> : <><ChevronDown className="w-3.5 h-3.5" />Edit rules</>}
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
              <span className="text-xs text-red-600">Remove?</span>
              <button onClick={() => { onDelete(); setConfirmDelete(false); }} className="text-xs font-semibold text-red-600 hover:text-red-800">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-500 hover:text-gray-700">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="p-1 text-gray-300 hover:text-red-400 transition-colors rounded">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Pending review explanation box */}
      {isPendingReview && schema.isActive && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
          <span>
            <strong>⚠ Some mapping rules have confidence &lt; 85%.</strong> Review and edit the rules below,
            then click <strong>Approve</strong> to activate this schema for live routing.
          </span>
        </div>
      )}

      {isExpanded && (
        <div className={cn('px-4 pb-4 pt-1 space-y-3 bg-white border-t', isInbound ? 'border-purple-100' : 'border-teal-100')}>
          <div className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
            isInbound
              ? 'bg-purple-50 text-purple-700 border-purple-200'
              : 'bg-teal-50 text-teal-700 border-teal-200'
          )}>
            {isInbound ? <ArrowLeft className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
            {isInbound ? 'Inbound reshape rules' : 'Outbound source mapping rules'}
          </div>
          <RulesEditor rules={editingRules ?? schema.mappingRules} onChange={onRulesChange} />
          <div className="flex items-center gap-3 pt-1">
            <Button size="sm" loading={saving} onClick={onSave}>
              <Save className="w-3.5 h-3.5 mr-1.5" />Save Changes
            </Button>
            {!schema.isActive && (editingRules ?? schema.mappingRules).every(r => r.confidence >= 0.85) &&
              schema.status !== 'pending_review' && (
              <Button size="sm" variant="secondary" onClick={async () => { await onSave(); onActivate(); }}>
                <Zap className="w-3.5 h-3.5 mr-1" />Save & Activate
              </Button>
            )}
            <button onClick={onToggle} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Validate Integration Panel ──────────────────────────────────────────────
interface ConnectionTest {
  id: string;
  initiatorPartnerId: string;
  receiverPartnerId: string;
  initiatorPartnerName: string;
  receiverPartnerName: string;
  format: string;
  testPayload: string;
  status: 'pending' | 'delivered' | 'confirmed' | 'rejected' | 'expired';
  initiatorNotes: string | null;
  receiverNotes: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

function ValidateIntegrationPanel({ schemas, myPartnerId }: { schemas: Schema[]; myPartnerId: string | null }) {
  const [targets, setTargets] = useState<SendTarget[]>([]);
  const [targetPartnerId, setTargetPartnerId] = useState('');
  const [testFormat, setTestFormat] = useState('json');
  const [payload, setPayload] = useState(FORMAT_FALLBACK_SAMPLES.json);
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<ConnectionTest | null>(null);
  const [error, setError] = useState('');

  // Incoming validations this partner needs to action
  const [incoming, setIncoming] = useState<ConnectionTest[]>([]);
  const [actioning, setActioning] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});

  const activeFormats = [...new Set(schemas.filter(s => s.isActive).map(s => s.format))];

  const loadIncoming = useCallback(() => {
    integrationsApi.listValidations('receiver', 'pending')
      .then(r => setIncoming((r.data as { data: ConnectionTest[] }).data ?? []))
      .catch(() => setIncoming([]));
    integrationsApi.listValidations('receiver', 'delivered')
      .then(r => setIncoming(prev => {
        const ids = new Set(prev.map(v => v.id));
        const extra = ((r.data as { data: ConnectionTest[] }).data ?? []).filter(v => !ids.has(v.id));
        return [...prev, ...extra];
      }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    subscriptionsApi.getSendTargets()
      .then(r => setTargets((r.data as { data: SendTarget[] }).data ?? []))
      .catch(() => setTargets([]));
    loadIncoming();
  }, [loadIncoming]);

  const handleFormatChange = (f: string) => {
    setTestFormat(f);
    setPayload(FORMAT_FALLBACK_SAMPLES[f] ?? FORMAT_FALLBACK_SAMPLES.json);
    setSent(null);
    setError('');
  };

  const handleSend = async () => {
    if (!myPartnerId || !targetPartnerId) { setError('Select a target partner first.'); return; }
    setSending(true); setSent(null); setError('');
    try {
      const r = await integrationsApi.initiateValidation(targetPartnerId, testFormat, payload, notes || undefined);
      setSent((r.data as { data: ConnectionTest }).data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to send validation. Check there is an active subscription.');
    } finally {
      setSending(false);
    }
  };

  const handleConfirm = async (id: string) => {
    setActioning(id);
    try {
      await integrationsApi.confirmValidation(id);
      setIncoming(prev => prev.filter(v => v.id !== id));
    } catch { /* ignore */ } finally { setActioning(null); }
  };

  const handleReject = async (id: string) => {
    setActioning(id);
    try {
      await integrationsApi.rejectValidation(id, rejectNotes[id]);
      setIncoming(prev => prev.filter(v => v.id !== id));
    } catch { /* ignore */ } finally { setActioning(null); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
      pending:   { icon: <Clock className="w-3 h-3" />,        cls: 'bg-amber-50 text-amber-700 border-amber-200',  label: 'Pending' },
      delivered: { icon: <SendHorizonal className="w-3 h-3" />, cls: 'bg-blue-50 text-blue-700 border-blue-200',   label: 'Delivered — awaiting confirmation' },
      confirmed: { icon: <CheckCircle2 className="w-3 h-3" />, cls: 'bg-green-50 text-green-700 border-green-200', label: 'Confirmed ✓' },
      rejected:  { icon: <XCircle className="w-3 h-3" />,      cls: 'bg-red-50 text-red-700 border-red-200',       label: 'Rejected' },
      expired:   { icon: <Clock className="w-3 h-3" />,        cls: 'bg-gray-50 text-gray-500 border-gray-200',    label: 'Expired' },
    };
    const s = map[status] ?? map.pending;
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs border rounded-full px-2 py-0.5', s.cls)}>
        {s.icon}{s.label}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* ── Incoming validations awaiting action ── */}
      {incoming.length > 0 && (
        <Card title="">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-4 h-4 text-amber-500" />
            <span className="font-semibold text-gray-800">
              Incoming Validation Requests ({incoming.length})
            </span>
            <span className="text-xs text-gray-400">— Partners waiting for you to confirm their integration</span>
          </div>
          <div className="space-y-4">
            {incoming.map(test => (
              <div key={test.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800 text-sm">{test.initiatorPartnerName}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                    <span className="font-medium text-gray-600 text-sm">You</span>
                    <span className="ml-1 text-xs font-mono bg-gray-100 border border-gray-200 text-gray-600 px-2 py-0.5 rounded">
                      {test.format.toUpperCase()}
                    </span>
                  </div>
                  {statusBadge(test.status)}
                </div>
                {test.initiatorNotes && (
                  <p className="text-xs text-gray-600 italic">&quot;{test.initiatorNotes}&quot;</p>
                )}
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-700 select-none">
                    View test payload
                  </summary>
                  <pre className="mt-2 bg-gray-900 text-green-300 rounded-lg p-3 overflow-auto max-h-48 font-mono text-xs leading-relaxed">
                    {test.testPayload}
                  </pre>
                </details>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => handleConfirm(test.id)}
                    loading={actioning === test.id}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />Confirm — I can receive this
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleReject(test.id)}
                    loading={actioning === test.id}
                    className="border border-red-300 text-red-600 hover:bg-red-50"
                  >
                    <XCircle className="w-3.5 h-3.5 mr-1" />Reject
                  </Button>
                  <input
                    type="text"
                    placeholder="Optional notes for sender…"
                    value={rejectNotes[test.id] ?? ''}
                    onChange={e => setRejectNotes(prev => ({ ...prev, [test.id]: e.target.value }))}
                    className="flex-1 min-w-[180px] text-xs border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <p className="text-xs text-gray-400">Received {fmtDateTime(test.createdAt)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Send validation to a partner ── */}
      <Card title="Validate Integration with Partner">
        <p className="text-sm text-gray-500 mb-4">
          Send a real test message to a partner through the live integration flow.
          They will receive it and confirm (or reject) that they can correctly process your payload.
        </p>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Target Partner</label>
              <select
                value={targetPartnerId}
                onChange={e => { setTargetPartnerId(e.target.value); setSent(null); setError(''); }}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
              >
                <option value="">Select a subscribed partner…</option>
                {targets.map(t => (
                  <option key={t.partnerId} value={t.partnerId}>{t.companyName}</option>
                ))}
              </select>
              {targets.length === 0 && (
                <p className="text-xs text-gray-400">No subscriptions found — subscribe to a partner first.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Message Format</label>
              <div className="flex flex-wrap gap-2">
                {PORTAL_FORMATS.map(f => {
                  const hasSchema = activeFormats.includes(f);
                  return (
                    <button
                      key={f} type="button"
                      onClick={() => handleFormatChange(f)}
                      title={hasSchema ? undefined : 'No active schema for this format'}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                        testFormat === f ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500',
                      )}
                    >
                      {f.toUpperCase()}
                      {hasSchema && <span className="ml-1 text-green-400">●</span>}
                    </button>
                  );
                })}
              </div>
              {activeFormats.length === 0 && (
                <p className="text-xs text-amber-600">Register and activate a schema above to validate.</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Test Payload</label>
            <Textarea
              value={payload}
              onChange={e => setPayload(e.target.value)}
              rows={6}
              className="font-mono text-xs"
              placeholder="Paste a sample payload in the selected format…"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">
              Notes for Receiver <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Testing order flow — please confirm field mapping is correct"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <Button onClick={handleSend} loading={sending} disabled={!targetPartnerId}>
            <SendHorizonal className="w-4 h-4 mr-1.5" />Send Validation Request
          </Button>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {sent && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                <span className="font-semibold text-indigo-800 text-sm">Validation request sent!</span>
                {statusBadge(sent.status)}
              </div>
              <p className="text-xs text-gray-600">
                <strong>{sent.receiverPartnerName}</strong> will see an incoming validation request on their
                Schema Mapping page and can confirm or reject it. You&apos;ll see the result reflected here.
              </p>
              <p className="text-xs text-gray-400">ID: <code className="font-mono">{sent.id}</code></p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Test Mapping Panel (kept for local simulation) ───────────────────────────
function TestMappingPanel({ schemas, myPartnerId }: { schemas: Schema[]; myPartnerId: string | null }) {
  const [testFormat, setTestFormat] = useState('json');
  const [payload, setPayload] = useState(FORMAT_FALLBACK_SAMPLES.json);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TransformResult | null>(null);
  const [testError, setTestError] = useState('');

  // Formats that have at least one active schema for this partner
  const activeFormats = [...new Set(schemas.filter(s => s.isActive).map(s => s.format))];

  const handleFormatChange = (f: string) => {
    setTestFormat(f);
    setPayload(FORMAT_FALLBACK_SAMPLES[f] ?? FORMAT_FALLBACK_SAMPLES.json);
    setResult(null);
    setTestError('');
  };

  const runTransform = async () => {
    if (!myPartnerId) { setTestError('Could not determine your partner identity.'); return; }
    setRunning(true); setResult(null); setTestError('');
    try {
      const r = await mappingsApi.testTransform(payload, testFormat, myPartnerId, myPartnerId, true);
      setResult((r.data as { data: TransformResult }).data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setTestError(msg ?? 'Transform failed. Check your schema rules match the payload structure.');
    } finally {
      setRunning(false);
    }
  };

  const prettyJson = (raw: string) => {
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
  };

  const isEmpty = (raw: string) => {
    try { const parsed = JSON.parse(raw); return typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length === 0; }
    catch { return false; }
  };

  const stageModels = result?.llmContext?.stages.map((stage) => stage.model) ?? [];
  const uniqueModels = [...new Set(stageModels)];
  const usedLlm = uniqueModels.length > 0;

  return (
    <Card title="Test Schema → CDM Mapping">
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5 text-xs text-blue-700">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-400" />
          <span>
            This is a <strong>local simulation</strong> — it exercises the stage-1 mapping engine used in live routing,
            but no message is sent to any partner. This test stops at the <strong>CDM JSON</strong> output so you can verify
            source-to-CDM behavior without invoking the second-stage partner-format reshape.
          </span>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Source Format</label>
          <div className="flex flex-wrap gap-2">
            {PORTAL_FORMATS.map(f => {
              const hasSchema = activeFormats.includes(f);
              return (
                <button
                  key={f} type="button"
                  onClick={() => hasSchema && handleFormatChange(f)}
                  title={hasSchema ? undefined : 'No active schema for this format'}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                    testFormat === f ? 'bg-gray-800 text-white border-gray-800'
                      : hasSchema ? 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
                        : 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed',
                  )}
                >
                  {f.toUpperCase()}
                  {hasSchema && <span className="ml-1 text-green-500">●</span>}
                </button>
              );
            })}
          </div>
          {activeFormats.length === 0 && (
            <p className="text-xs text-amber-600">No active schemas — register and activate a schema above first.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Sample Payload</label>
          <Textarea
            value={payload}
            onChange={e => setPayload(e.target.value)}
            rows={6}
            className="font-mono text-xs"
          />
        </div>

        <Button onClick={runTransform} loading={running} disabled={activeFormats.length === 0 || !myPartnerId}>
          <FlaskConical className="w-4 h-4 mr-1.5" />Test CDM Mapping
        </Button>

        {testError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{testError}</div>
        )}

        {result && (
          <div className="space-y-3 border-t border-gray-100 pt-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">CDM output</span>
              <span className="inline-flex items-center gap-1.5 text-xs">
                <span className="font-mono bg-gray-100 border border-gray-200 text-gray-600 px-2 py-0.5 rounded">
                  {testFormat.toUpperCase()}
                </span>
                <ArrowRight className="w-3 h-3 text-indigo-400" />
                <Zap className="w-3 h-3 text-indigo-500" />
                <span className="font-mono bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded">CDM</span>
              </span>
              {result.rulesApplied != null && (
                <span className="text-xs text-gray-400 ml-auto">Rules applied: {result.rulesApplied}</span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
                usedLlm ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-gray-50 text-gray-500 border-gray-200'
              }`}>
                <Cpu className="w-3 h-3" />
                {usedLlm ? `LLM used: ${uniqueModels.join(', ')}` : 'No LLM trace returned'}
              </span>
              {result.llmContext?.stages?.length ? (
                <span className="text-gray-400">
                  {result.llmContext.stages.length} stage{result.llmContext.stages.length > 1 ? 's' : ''} recorded
                </span>
              ) : null}
            </div>

            {isEmpty(result.cdmPayload) && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
                <span>
                  The CDM result is empty — check that your schema&apos;s source fields match the payload structure.
                </span>
              </div>
            )}

            <pre className="bg-gray-900 text-green-300 rounded-lg p-4 text-xs overflow-auto max-h-80 font-mono leading-relaxed">
              {prettyJson(result.cdmPayload)}
            </pre>

            {result.llmContext?.stages?.length ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">LLM stage trace</p>
                <div className="space-y-2">
                  {result.llmContext.stages.map((stage, index) => (
                    <div key={`${stage.stage}-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-gray-700">Stage {stage.stage}</span>
                        <span className="text-xs text-gray-500">{stage.label}</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-white border border-indigo-200 px-2 py-0.5 text-xs text-indigo-700">
                          <Cpu className="w-3 h-3" />
                          {stage.model}
                        </span>
                        <span className="text-xs text-gray-400">
                          {stage.inputTokens} in / {stage.outputTokens} out tokens
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Schema Health Summary Bar ────────────────────────────────────────────────
function SchemaHealthBar({ schemas }: { schemas: Schema[] }) {
  const total = schemas.length;
  const active = schemas.filter(s => s.isActive).length;
  const pendingReview = schemas.filter(s => s.status === 'pending_review').length;
  const lowConf = schemas.filter(s => s.mappingRules.some(r => r.confidence < 0.85)).length;

  const chip = (label: string, value: number, highlight?: boolean) => (
    <div className={cn(
      'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm',
      highlight && value > 0
        ? 'bg-amber-50 border-amber-200 text-amber-800'
        : 'bg-white border-gray-200 text-gray-700',
    )}>
      <span className="font-bold text-base">{value}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );

  return (
    <div className="flex flex-wrap gap-2">
      {chip('Total schemas', total)}
      {chip('Active', active)}
      {chip('Pending review', pendingReview, true)}
      {chip('Low confidence', lowConf, true)}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MappingsPage() {
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [format, setFormat] = useState('json');
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [messageType, setMessageType] = useState('orders');
  const [customMessageType, setCustomMessageType] = useState('');
  const [sample, setSample] = useState(getSchemaSamplePayload('orders', 'json'));
  const [schemaDefinition, setSchemaDefinition] = useState('');
  const [showSchemaInput, setShowSchemaInput] = useState(false);
  const [newResult, setNewResult] = useState<Schema | null>(null);
  const [newResultRules, setNewResultRules] = useState<MappingRule[]>([]);
  const [savingNew, setSavingNew] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingRules, setEditingRules] = useState<MappingRule[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [schemaListDirection, setSchemaListDirection] = useState<'outbound' | 'inbound'>('outbound');

  const myPartnerId = typeof window !== 'undefined' ? getPartnerId() : null;
  const effectiveMessageType = messageType === 'custom' ? customMessageType.trim().toLowerCase() : messageType;

  useEffect(() => {
    setSample(
      messageType === 'custom'
        ? FORMAT_FALLBACK_SAMPLES[format] ?? FORMAT_FALLBACK_SAMPLES.json
        : getSchemaSamplePayload(messageType, format)
    );
  }, [format, messageType]);

  const loadSchemas = useCallback(async () => {
    if (!myPartnerId) return;
    try {
      const r = await mappingsApi.listSchemas(myPartnerId);
      setSchemas((r.data as { data: Schema[] }).data ?? []);
    } catch {
      setError('Failed to load registered schemas.');
    } finally {
      setLoading(false);
    }
  }, [myPartnerId]);

  useEffect(() => { loadSchemas(); }, [loadSchemas]);

  // Group schemas by messageType
  const byMessageType = schemas.reduce<Record<string, Schema[]>>((acc, s) => {
    const key = s.messageType ?? 'custom';
    (acc[key] ??= []).push(s);
    return acc;
  }, {});
  const schemasForSelectedDirection = schemas.filter(s => (s.schemaDirection ?? 'outbound') === schemaListDirection);
  const byMessageTypeForSelectedDirection = schemasForSelectedDirection.reduce<Record<string, Schema[]>>((acc, s) => {
    const key = s.messageType ?? 'custom';
    (acc[key] ??= []).push(s);
    return acc;
  }, {});

  // ── Register + AI map ──
  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveMessageType) { setError('Please enter a message type name.'); return; }
    setUploading(true); setNewResult(null); setError('');
    try {
      const r = await mappingsApi.registerSchema(format, effectiveMessageType, sample, direction, schemaDefinition.trim() || undefined);
      const schema = (r.data as { data: Schema }).data;
      setNewResult(schema);
      setNewResultRules(schema.mappingRules ?? []);
      await loadSchemas();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? (err as { message?: string })?.message
        ?? 'Schema registration failed.';
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const saveNewRules = async () => {
    if (!newResult) return;
    setSavingNew(true);
    try {
      const r = await mappingsApi.updateRules(newResult.id, newResultRules);
      setNewResult((r.data as { data: Schema }).data);
      await loadSchemas();
    } catch { setError('Failed to save mapping rules.'); }
    finally { setSavingNew(false); }
  };

  const toggleExpand = (s: Schema) => {
    if (expandedId === s.id) { setExpandedId(null); setEditingRules(null); }
    else { setExpandedId(s.id); setEditingRules(s.mappingRules.map(r => ({ ...r }))); }
  };

  const saveRules = async (id: string) => {
    if (!editingRules) return;
    setSavingId(id);
    try {
      await mappingsApi.updateRules(id, editingRules);
      setExpandedId(null); setEditingRules(null);
      await loadSchemas();
    } catch { setError('Failed to save mapping rules.'); }
    finally { setSavingId(null); }
  };

  const activate = async (id: string) => {
    try { await mappingsApi.activateSchema(id); await loadSchemas(); }
    catch { setError('Failed to activate schema version.'); }
  };

  const deleteSchema = async (id: string) => {
    try { await mappingsApi.deleteSchema(id); await loadSchemas(); }
    catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to delete schema version.');
    }
  };

  const approve = async (id: string) => {
    try { await mappingsApi.approveSchema(id); await loadSchemas(); }
    catch { setError('Failed to approve schema.'); }
  };

  const existingVersionCount = byMessageType[effectiveMessageType]?.filter(s => s.format === format).length ?? 0;
  const [activeTab, setActiveTab] = useState<'register' | 'validate' | 'test'>('register');

  const TABS = [
    { id: 'register' as const, label: 'Register Schema',        sub: 'AI Auto-Mapping',    icon: <Sparkles className="w-4 h-4" /> },
    { id: 'validate' as const, label: 'Validate Integration',   sub: 'With Partner',        icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'test'     as const, label: 'Test Schema → CDM',      sub: 'Local Simulation',    icon: <FlaskConical className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Schema Mapping</h1>
        <p className="text-gray-500 text-sm mt-1">
          Define the message types you support (ORDERS, INVOICES, etc.), upload a sample payload — AI maps it to the canonical model. Only the{' '}
          <Zap className="w-3.5 h-3.5 inline text-indigo-500 -mt-0.5" /> active version is used for live routing.
        </p>
      </div>

      {/* ── Schema health summary ── */}
      {!loading && <SchemaHealthBar schemas={schemas} />}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* ── Sub-navigation tabs ── */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-1" aria-label="Schema Mapping sections">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span className={cn(
                'text-xs font-normal hidden sm:inline',
                activeTab === tab.id ? 'text-indigo-400' : 'text-gray-400',
              )}>— {tab.sub}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* ── Tab panels ── */}
      {activeTab === 'register' && (
        <>
          <CdmReference />
          <Card title="Register Schema (AI Auto-Mapping)">
            <form onSubmit={register} className="space-y-5">

              {/* Schema Direction */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Schema direction</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setDirection('outbound')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors flex items-center gap-2 ${direction === 'outbound' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}>
                    <ArrowRight className="w-4 h-4" /> Outbound <span className="font-normal text-xs opacity-80">(I send this format → CDM)</span>
                  </button>
                  <button type="button" onClick={() => setDirection('inbound')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors flex items-center gap-2 ${direction === 'inbound' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400'}`}>
                    <ArrowLeft className="w-4 h-4" /> Inbound <span className="font-normal text-xs opacity-80">(CDM → I receive this format)</span>
                  </button>
                </div>
                {direction === 'outbound'
                  ? <p className="text-xs text-gray-500">Upload a sample of <strong>your own outgoing format</strong>. AI will map your fields → CDM fields.</p>
                  : <p className="text-xs text-purple-700 bg-purple-50 rounded px-2 py-1">Upload a sample of <strong>your own internal format</strong> (what you want to <em>receive</em>). AI will map CDM fields → your fields so partners can deliver to you.</p>
                }
              </div>

              {/* Message Type */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  <Tag className="w-3.5 h-3.5 inline mr-1 text-indigo-500" />Message type
                </label>
                <div className="flex flex-wrap gap-2">
                  {STANDARD_SCHEMA_MESSAGE_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setMessageType(t)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors uppercase ${messageType === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}>
                      {t}
                    </button>
                  ))}
                  <button type="button" onClick={() => setMessageType('custom')}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${messageType === 'custom' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}>
                    + Custom
                  </button>
                </div>
                {messageType === 'custom' && (
                  <input
                    value={customMessageType} onChange={e => setCustomMessageType(e.target.value)}
                    placeholder="e.g. purchase-orders, remittance-advice…"
                    className="w-full sm:w-72 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                )}
              </div>

              {/* Wire format */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Wire format</label>
                <div className="flex flex-wrap gap-2">
                  {PORTAL_FORMATS.map(f => (
                    <button key={f} type="button" onClick={() => setFormat(f)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${format === f ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'}`}>
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
                {existingVersionCount > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                    <GitBranch className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>You already have <strong>{existingVersionCount} {effectiveMessageType.toUpperCase()}/{format.toUpperCase()} version{existingVersionCount > 1 ? 's' : ''}</strong>. Uploading creates <strong>v{existingVersionCount + 1}</strong> as inactive.</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Textarea label="Sample payload" value={sample} onChange={e => setSample(e.target.value)} rows={7} className="font-mono text-xs" />
                <p className="text-xs text-gray-400">
                  The starter sample updates to match the selected message type and wire format. You can still edit it before registering.
                </p>
              </div>

              {/* Optional schema definition */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowSchemaInput(v => !v)}
                  className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                >
                  <FlaskConical className="w-4 h-4" />
                  {showSchemaInput ? 'Hide schema definition' : '+ Add schema definition (optional — improves AI accuracy)'}
                </button>
                {showSchemaInput && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 space-y-2">
                    <p className="text-xs text-indigo-700">
                      Provide a formal schema alongside your sample. The AI will use it to infer field names and types more precisely.
                      <br />
                      <span className="font-medium">JSON</span> → paste JSON Schema &nbsp;|&nbsp;
                      <span className="font-medium">XML</span> → paste XSD &nbsp;|&nbsp;
                      <span className="font-medium">CSV</span> → paste header row &nbsp;|&nbsp;
                      <span className="font-medium">EDI</span> → paste segment/element spec
                    </p>
                    <Textarea
                      label={format === 'xml' ? 'XSD / DTD schema' : format === 'csv' ? 'CSV header row' : format.startsWith('edi') ? 'EDI segment spec' : 'JSON Schema'}
                      value={schemaDefinition}
                      onChange={e => setSchemaDefinition(e.target.value)}
                      rows={6}
                      className="font-mono text-xs"
                      placeholder={
                        format === 'xml' ? '<?xml version="1.0"?><xs:schema …>' :
                        format === 'csv' ? 'OrderID,CustomerName,Amount,Currency,Date' :
                        format.startsWith('edi') ? 'ST*850*0001~\nBEG*00*SA*PO-001~' :
                        '{\n  "$schema": "http://json-schema.org/draft-07/schema",\n  "properties": { … }\n}'
                      }
                    />
                  </div>
                )}
              </div>

              <Button type="submit" loading={uploading} disabled={!effectiveMessageType}>
                <Sparkles className="w-4 h-4 mr-1.5" />
                {uploading ? 'AI is mapping…' : existingVersionCount > 0 ? `Upload as v${existingVersionCount + 1}` : 'Upload & Auto-Map'}
              </Button>
            </form>

            {/* AI result */}
            {newResult && (
              <div className="mt-6 space-y-4 border-t border-gray-100 pt-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-sm font-medium text-gray-700">AI Mapping Complete — v{newResult.version}</span>
                    <span className="text-xs font-semibold uppercase text-indigo-700 bg-indigo-100 rounded-full px-2 py-0.5">{newResult.messageType}</span>
                    <FormatPipeline sourceFormat={newResult.format} />
                    <Badge label={newResult.status} className={statusColor(newResult.status)} />
                    {newResult.schemaDirection === 'inbound'
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-xs font-semibold"><ArrowLeft className="w-3 h-3" />INBOUND</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 text-teal-700 px-2 py-0.5 text-xs font-semibold"><ArrowRight className="w-3 h-3" />OUTBOUND</span>
                    }
                    {newResult.isActive
                      ? <span className="text-xs text-indigo-600 font-semibold flex items-center gap-1"><Zap className="w-3 h-3" />Active</span>
                      : <span className="text-xs text-gray-400 flex items-center gap-1"><ZapOff className="w-3 h-3" />Not active yet</span>}
                  </div>
                  <span className="text-xs text-gray-400">{newResultRules.length} rules · edit freely below</span>
                </div>
                <RulesEditor rules={newResultRules} onChange={setNewResultRules} />
                <div className="flex items-center gap-3 pt-1">
                  <Button size="sm" loading={savingNew} onClick={saveNewRules}>
                    <Save className="w-3.5 h-3.5 mr-1.5" />Save Mapping
                  </Button>
                  {!newResult.isActive && (
                    <Button size="sm" variant="secondary" onClick={() => activate(newResult.id)}>
                      <Zap className="w-3.5 h-3.5 mr-1" />Activate This Version
                    </Button>
                  )}
                  <button onClick={() => { setNewResult(null); setNewResultRules([]); }} className="text-sm text-gray-500 hover:text-gray-700">Discard</button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── Validate Integration with Partner ── */}
      {activeTab === 'validate' && <ValidateIntegrationPanel schemas={schemas} myPartnerId={myPartnerId} />}

      {/* ── Test Mapping (local simulation) ── */}
      {activeTab === 'test' && <TestMappingPanel schemas={schemas} myPartnerId={myPartnerId} />}

      {/* ── Registered schemas — grouped by message type (shown under Register tab) ── */}
      {activeTab === 'register' && <div>
        {/* Partner routing context */}
        <div className="flex items-start gap-2 mb-3 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5 text-xs text-blue-700">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-400" />
          <span>
            <strong>Your schemas define how messages you SEND are transformed.</strong> When you send a message, the platform looks up your active schema for the matching format and maps it to CDM format for the receiver.
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-gray-900">My Message Type Schemas</h2>
            <p className="text-xs text-gray-500 mt-1">
              Switch between outbound schemas you send to the platform and inbound schemas you receive from CDM.
            </p>
          </div>
          <div className="flex gap-1 border border-gray-200 rounded-lg bg-white p-1">
            <button
              type="button"
              onClick={() => setSchemaListDirection('outbound')}
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors',
                schemaListDirection === 'outbound'
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              <ArrowRight className="w-4 h-4" />
              Outbound
              <span className="text-xs text-inherit/80">({schemas.filter(s => (s.schemaDirection ?? 'outbound') === 'outbound').length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSchemaListDirection('inbound')}
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors',
                schemaListDirection === 'inbound'
                  ? 'bg-purple-50 text-purple-700'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              <ArrowLeft className="w-4 h-4" />
              Inbound
              <span className="text-xs text-inherit/80">({schemas.filter(s => (s.schemaDirection ?? 'outbound') === 'inbound').length})</span>
            </button>
          </div>
        </div>
        {loading ? (
          <div className="text-gray-400 text-center py-8">Loading…</div>
        ) : schemas.length === 0 ? (
          <Card>
            <div className="text-center py-6 text-gray-400">
              <Cpu className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>No schemas registered yet. Choose a message type above and upload a sample payload.</p>
            </div>
          </Card>
        ) : Object.keys(byMessageTypeForSelectedDirection).length === 0 ? (
          <Card>
            <div className="text-center py-6 text-gray-400">
              <Cpu className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>
                No {schemaListDirection} schemas registered yet.
                {schemaListDirection === 'outbound'
                  ? ' Add one above to define how your messages map into CDM.'
                  : ' Add one above to define how CDM is reshaped into your receiving format.'}
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-5">
            {Object.entries(byMessageTypeForSelectedDirection).map(([msgType, versions]) => {
              const activeVersions = versions.filter(v => v.isActive);
              const formats = [...new Set(versions.map(v => v.format))];
              const hasIssue = activeVersions.some(v => v.status === 'pending_review');
              const directionIsInbound = schemaListDirection === 'inbound';
              return (
                <div
                  key={msgType}
                  className={cn(
                    'bg-white rounded-xl border shadow-sm overflow-hidden',
                    directionIsInbound ? 'border-purple-200' : 'border-teal-200'
                  )}
                >
                  {/* Message type header */}
                  <div
                    className={cn(
                      'flex items-center justify-between px-4 py-3 border-b',
                      hasIssue
                        ? 'bg-amber-50 border-amber-100'
                        : directionIsInbound
                          ? 'bg-purple-50/70 border-purple-100'
                          : 'bg-teal-50/70 border-teal-100'
                    )}
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <Tag className={cn('w-4 h-4', directionIsInbound ? 'text-purple-500' : 'text-teal-500')} />
                      <span className="font-bold text-sm text-gray-800 uppercase tracking-wide">{msgType}</span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                          directionIsInbound ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'
                        )}
                      >
                        {directionIsInbound ? <ArrowLeft className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
                        {directionIsInbound ? 'Inbound' : 'Outbound'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {formats.map(f => (
                          <span key={f} className="font-mono text-xs text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">
                            {f.toUpperCase()}
                          </span>
                        ))}
                      </div>
                      <span className="text-xs text-gray-400">{versions.length} version{versions.length > 1 ? 's' : ''}</span>
                      {activeVersions.length > 0
                        ? <span className="text-xs text-gray-500 flex items-center gap-1"><Zap className="w-3 h-3 text-indigo-400" />{activeVersions.length} active</span>
                        : <span className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />No active version</span>}
                    </div>
                    {hasIssue && (
                      <span className="text-xs text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" />Active version needs review
                      </span>
                    )}
                  </div>
                  {/* Version rows */}
                  {versions.map(s => (
                    <VersionRow
                      key={s.id}
                      schema={s}
                      isExpanded={expandedId === s.id}
                      editingRules={expandedId === s.id ? editingRules : null}
                      onToggle={() => toggleExpand(s)}
                      onRulesChange={setEditingRules}
                      onSave={() => saveRules(s.id)}
                      onActivate={() => activate(s.id)}
                      onApprove={() => approve(s.id)}
                      onDelete={() => deleteSchema(s.id)}
                      saving={savingId === s.id}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>}
    </div>
  );
}
