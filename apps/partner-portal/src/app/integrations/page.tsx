'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { integrationsApi, subscriptionsApi, mappingsApi } from '@/lib/api';
import { getPartnerId, isAdmin } from '@/lib/utils';
import { Badge, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { statusColor, fmtDateTime, cn } from '@/lib/utils';
import {
  Send, RefreshCw, Search, X, ArrowUpRight, ArrowDownLeft, ChevronRight, ChevronDown,
  Zap, AlertCircle, CheckCircle, AlertTriangle, Activity, Package, ArrowRight, Bot,
  Copy, Check,
} from 'lucide-react';

interface Message {
  id: string;
  sourcePartnerId: string;
  targetPartnerId: string;
  sourcePartnerName?: string;
  targetPartnerName?: string;
  format: string;
  status: string;
  retries: number;
  rawPayload?: string;
  mappedPayload?: string;
  cdmPayload?: string;
  llmContext?: {
    stages: {
      stage: number;
      label: string;
      model: string;
      prompt: string;
      response: string;
    }[];
  };
  errorMessage?: string;
  schemaId?: string;
  schemaVersion?: number;
  schemaFormat?: string;
  outputFormat?: string;
  createdAt: string;
  updatedAt: string;
}

interface SendTarget { partnerId: string; companyName: string; subscriptionId: string }
interface SchemaReg { id: string; format: string; status: string; isActive: boolean; version: number }
interface Stats { total: number; delivered: number; failed: number; processing: number }

const STATUSES = ['', 'received', 'processing', 'delivered', 'failed', 'dead_lettered'];
const FORMATS = ['json', 'xml', 'csv', 'edi-x12', 'edifact'];
const PAGE_SIZE = 20;

const FORMAT_LABELS: Record<string, string> = {
  json: 'JSON', xml: 'XML', csv: 'CSV', 'edi-x12': 'EDI X12', edifact: 'EDIFACT',
};

const FORMAT_EXAMPLES: Record<string, string> = {
  json: '{\n  "orderId": "ORD-001",\n  "total": 99.99\n}',
  xml: '<Order>\n  <OrderId>ORD-001</OrderId>\n  <Total>99.99</Total>\n</Order>',
  csv: 'orderId,total\nORD-001,99.99',
  'edi-x12': 'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *230101*1200*^*00501*000000001*0*P*>~',
  edifact: "UNA:+.? 'UNB+UNOA:1+SENDER+RECEIVER+230101:1200+1'",
};

const FORMAT_COLORS: Record<string, string> = {
  json: 'bg-blue-100 text-blue-700',
  xml: 'bg-purple-100 text-purple-700',
  csv: 'bg-orange-100 text-orange-700',
  'edi-x12': 'bg-teal-100 text-teal-700',
  edifact: 'bg-pink-100 text-pink-700',
};

function isEmptyPayload(payload?: string): boolean {
  if (!payload) return true;
  const t = payload.trim();
  return t === '{}' || t === '"{}"';
}

function fmtLabel(f: string) { return FORMAT_LABELS[f] ?? f.toUpperCase(); }
function fmtColor(f: string) { return FORMAT_COLORS[f] ?? 'bg-gray-100 text-gray-600'; }

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-100"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function getMappingState(msg: Pick<Message, 'schemaId' | 'cdmPayload' | 'errorMessage' | 'status'>): {
  label: string;
  className: string;
} {
  if (msg.errorMessage?.startsWith('Mapping warning:')) {
    return {
      label: 'Fallback',
      className: 'bg-amber-50 text-amber-700 border border-amber-200',
    };
  }

  if (!msg.schemaId) {
    if (msg.status === 'failed') {
      return {
        label: 'No schema',
        className: 'bg-red-50 text-red-600 border border-red-200',
      };
    }
    return {
      label: 'As-is',
      className: 'bg-gray-50 text-gray-500 border border-gray-200',
    };
  }

  if (isEmptyPayload(msg.cdmPayload)) {
    return {
      label: 'Empty CDM',
      className: 'bg-amber-50 text-amber-700 border border-amber-200',
    };
  }

  return {
    label: 'Mapped',
    className: 'bg-green-50 text-green-700 border border-green-200',
  };
}

/* ── Format badge shown in table rows ──────────────────────────────────────── */
function FormatBadge({ format, outputFormat, schemaId }: { format: string; outputFormat?: string; schemaId?: string }) {
  if (schemaId && outputFormat && outputFormat !== format) {
    return (
      <span className="flex items-center gap-1 flex-wrap">
        <span className={cn('font-mono text-xs px-1.5 py-0.5 rounded', fmtColor(format))}>{fmtLabel(format)}</span>
        <span className="text-gray-400 text-xs">→</span>
        <span className={cn('font-mono text-xs px-1.5 py-0.5 rounded', fmtColor(outputFormat))}>{fmtLabel(outputFormat)}</span>
      </span>
    );
  }
  if (schemaId) {
    return (
      <span className={cn('font-mono text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1', fmtColor(format))}>
        <Zap className="w-3 h-3" />{fmtLabel(outputFormat ?? format)}
      </span>
    );
  }
  return <span className={cn('font-mono text-xs px-1.5 py-0.5 rounded', fmtColor(format))}>{fmtLabel(format)}</span>;
}

/* ── Mapping quality badge shown in table rows ─────────────────────────────── */
function MappingBadge({ schemaId, cdmPayload }: { schemaId?: string; cdmPayload?: string }) {
  if (!schemaId) return <span className="text-gray-300 text-xs">—</span>;
  if (isEmptyPayload(cdmPayload)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
        <AlertTriangle className="w-3 h-3" />Empty CDM
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
      <Zap className="w-3 h-3" />Mapped
    </span>
  );
}

function MappingStatusBadge({ msg }: { msg: Pick<Message, 'schemaId' | 'cdmPayload' | 'errorMessage' | 'status'> }) {
  const mappingState = getMappingState(msg);
  const isWarning = mappingState.label === 'Fallback' || mappingState.label === 'No schema';
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded', mappingState.className)}>
      {isWarning ? <AlertTriangle className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
      {mappingState.label}
    </span>
  );
}

/* ── Stats card ────────────────────────────────────────────────────────────── */
function StatCard({ label, value, colorCls, icon }: { label: string; value: number; colorCls: string; icon: React.ReactNode }) {
  return (
    <div className={cn('rounded-xl border px-5 py-4 flex items-center gap-4', colorCls)}>
      <div className="shrink-0">{icon}</div>
      <div>
        <p className="text-2xl font-bold leading-none">{(value ?? 0).toLocaleString()}</p>
        <p className="text-xs font-medium mt-1 opacity-70">{label}</p>
      </div>
    </div>
  );
}

/* ── LLM Stage Trace accordion ─────────────────────────────────────────────── */
function LlmStageBlock({ stg }: {
  stg: { stage: number; label: string; model: string; prompt: string; response: string };
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'prompt' | 'response'>('prompt');
  const tryPretty = (s: string) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">{stg.stage}</span>
          <span className="text-xs font-semibold text-gray-700">{stg.label}</span>
          <span className="text-xs text-gray-400 font-mono">{stg.model}</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="p-3 space-y-2">
          <div className="flex gap-1">
            {(['prompt', 'response'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={cn('px-2.5 py-1 text-xs rounded font-medium transition-colors',
                  tab === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                {t === 'prompt' ? '📤 Sent to LLM' : '📥 LLM Response'}
              </button>
            ))}
          </div>
          <pre className={cn(
            'text-xs overflow-auto max-h-72 whitespace-pre-wrap rounded-lg p-3 border',
            tab === 'prompt' ? 'bg-blue-50 border-blue-100 text-blue-900' : 'bg-emerald-50 border-emerald-100 text-emerald-900',
          )}>
            {tab === 'prompt' ? stg.prompt : tryPretty(stg.response)}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Detail Panel ──────────────────────────────────────────────────────────── */
function DetailPanel({
  msg,
  myId,
  admin,
  onClose,
  onResend,
}: {
  msg: Message;
  myId: string;
  admin: boolean;
  onClose: () => void;
  onResend: (msg: Message) => Promise<string | undefined>;
}) {
  const tryPretty = (s?: string) => {
    try { return JSON.stringify(JSON.parse(s ?? ''), null, 2); } catch { return s ?? '—'; }
  };
  const [resending, setResending] = useState(false);
  const [resendResult, setResendResult] = useState<{ ok: boolean; text: string } | null>(null);
  const displayStatus = (status: string) =>
    status === 'delivered' && msg.targetPartnerId === myId ? 'received' : status;
  const senderView = !admin && msg.sourcePartnerId === myId;
  const visibleCdmPayload = msg.cdmPayload;
  const visibleDeliveredPayload = admin || !senderView ? msg.mappedPayload : undefined;
  const visibleRawPayload = admin || senderView ? msg.rawPayload : undefined;

  const hasMappingWarning = msg.errorMessage?.startsWith('Mapping warning:');
  const hasMapping = !!msg.schemaId;
  const hasFailedMappingAttempt = hasMappingWarning && !hasMapping;
  // No schema + message failed = schema was missing, not delivered as-is
  const hasMissingSchema = !hasMapping && !hasMappingWarning && msg.status === 'failed';
  const hasFormatTransform = hasMapping && !!msg.outputFormat && msg.outputFormat !== msg.format;
  const emptyCdm = isEmptyPayload(visibleCdmPayload);
  const hasVisibleCdm = !!visibleCdmPayload && visibleCdmPayload !== msg.rawPayload;
  const hasVisibleDeliveredPayload = !!visibleDeliveredPayload
    && visibleDeliveredPayload !== msg.rawPayload
    && visibleDeliveredPayload !== visibleCdmPayload;
  const mappingState = getMappingState(msg);

  let cdmFieldCount = 0;
  if (!emptyCdm && visibleCdmPayload) {
    try { cdmFieldCount = Object.keys(JSON.parse(visibleCdmPayload)).length; } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col h-full overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Message Detail</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-5 text-sm">
          {/* ── a) Format Flow ─────────────────────────────────────────── */}
          <div className="border border-gray-100 rounded-lg p-4 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Format Flow</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('font-mono text-sm font-semibold px-2.5 py-1 rounded-lg', fmtColor(msg.format))}>
                {fmtLabel(msg.format)}
              </span>
              {hasMapping ? (
                <>
                  <span className="text-gray-400 text-xs">→</span>
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">
                    <Zap className="w-3 h-3" />CDM
                  </span>
                  {msg.outputFormat && (
                    <>
                      <span className="text-gray-400 text-xs">→</span>
                      <span className={cn('font-mono text-sm font-semibold px-2.5 py-1 rounded-lg', fmtColor(msg.outputFormat))}>
                        {fmtLabel(msg.outputFormat)}
                      </span>
                    </>
                  )}
                </>
              ) : hasFailedMappingAttempt ? (
                <>
                  <span className="text-gray-400 text-xs">→</span>
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                    <AlertTriangle className="w-3 h-3" />Mapping fallback
                  </span>
                  <span className="text-gray-400 text-xs">→</span>
                  <span className={cn('font-mono text-sm font-semibold px-2.5 py-1 rounded-lg', fmtColor(msg.format))}>
                    {fmtLabel(msg.format)}
                  </span>
                </>
              ) : hasMissingSchema ? (
                <>
                  <span className="text-gray-400 text-xs">→</span>
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-red-100 text-red-600 font-medium">
                    <AlertTriangle className="w-3 h-3" />No schema
                  </span>
                </>
              ) : (
                <>
                  <span className="text-gray-400 text-xs">→</span>
                  <span className="text-xs text-gray-400 italic">as-is</span>
                  <span className="text-gray-400 text-xs">→</span>
                  <span className={cn('font-mono text-sm font-semibold px-2.5 py-1 rounded-lg', fmtColor(msg.format))}>
                    {fmtLabel(msg.format)}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
              <span className="font-medium">{msg.sourcePartnerName ?? msg.sourcePartnerId.slice(0, 8) + '…'}</span>
              <span className="text-gray-300">→</span>
              <span className="font-medium">{msg.targetPartnerName ?? msg.targetPartnerId.slice(0, 8) + '…'}</span>
            </div>
          </div>

          {/* ── Core meta grid ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-400 mb-0.5">Message ID</p><p className="font-mono text-xs text-gray-700 break-all">{msg.id}</p></div>
              <div><p className="text-xs text-gray-400 mb-0.5">Status</p><Badge label={displayStatus(msg.status)} className={statusColor(msg.status)} /></div>
              <div><p className="text-xs text-gray-400 mb-0.5">Mapping Status</p><MappingStatusBadge msg={msg} /></div>
              <div><p className="text-xs text-gray-400 mb-0.5">Retries</p><p className="text-gray-700">{msg.retries}</p></div>
              <div><p className="text-xs text-gray-400 mb-0.5">Sent at</p><p className="text-gray-700 text-xs">{fmtDateTime(msg.createdAt)}</p></div>
              <div><p className="text-xs text-gray-400 mb-0.5">Updated at</p><p className="text-gray-700 text-xs">{fmtDateTime(msg.updatedAt)}</p></div>
            <div className="col-span-2"><p className="text-xs text-gray-400 mb-0.5">From (Sender)</p><p className="font-semibold text-gray-800">{msg.sourcePartnerName ?? '—'}</p><p className="font-mono text-xs text-gray-400 break-all">{msg.sourcePartnerId}</p></div>
            <div className="col-span-2"><p className="text-xs text-gray-400 mb-0.5">To (Receiver)</p><p className="font-semibold text-gray-800">{msg.targetPartnerName ?? '—'}</p><p className="font-mono text-xs text-gray-400 break-all">{msg.targetPartnerId}</p></div>
          </div>

          {/* ── b) Mapping Diagnosis ───────────────────────────────────── */}
          {msg.schemaId ? (
            <div className="border border-indigo-100 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-indigo-50 flex items-center gap-2">
                <Zap className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">Mapping Diagnosis</span>
              </div>
              <div className="px-4 py-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-gray-400">Schema ID</span><p className="font-mono text-gray-700">{msg.schemaId.slice(0, 12)}…</p></div>
                  <div><span className="text-gray-400">Version</span><p className="text-gray-700">v{msg.schemaVersion ?? '?'}</p></div>
                  <div><span className="text-gray-400">Schema Format</span><p className="font-mono text-gray-700">{(msg.schemaFormat ?? msg.format).toUpperCase()}</p></div>
                  <div><span className="text-gray-400">Visible Output</span><p className="font-mono text-gray-700">{senderView ? 'CDM' : (msg.outputFormat ?? msg.format).toUpperCase()}</p></div>
                </div>
                {hasVisibleCdm ? (
                  emptyCdm ? (
                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-amber-700 mb-1">⚠ CDM output is empty</p>
                        <p className="text-xs text-amber-600">
                          All mapping rules failed to match. Check that your schema was registered with a sample payload
                          matching this message format. The payload was delivered as-is.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 bg-green-50 border border-green-200 rounded-lg p-2.5 flex gap-2 items-center">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      <p className="text-xs text-green-700 font-medium">
                        ✓ CDM mapping produced {cdmFieldCount} field{cdmFieldCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  )
                ) : (
                  <div className="mt-2 bg-green-50 border border-green-200 rounded-lg p-2.5 flex gap-2 items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    <p className="text-xs text-green-700 font-medium">
                      ✓ Delivery payload prepared for {fmtLabel(msg.outputFormat ?? msg.format)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : hasFailedMappingAttempt ? (
            <div className="border border-amber-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-amber-50 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Mapping Diagnosis</span>
              </div>
              <div className="px-4 py-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-gray-400">Mapping Status</span><p className="text-amber-700 font-medium">Attempted but timed out</p></div>
                  <div><span className="text-gray-400">Visible Output</span><p className="font-mono text-gray-700">{msg.format.toUpperCase()}</p></div>
                </div>
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-amber-700 mb-1">⚠ Mapping attempt fell back to the original payload</p>
                    <p className="text-xs text-amber-600">
                      The mapping service did not finish in time, so no transformed payload was recorded and the original
                      payload was delivered as-is.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-500">
              No mapping applied — payload delivered as-is (no active schema found for this partner/format)
            </div>
          )}

          {/* ── c) Error / Warning section ─────────────────────────────── */}
          {msg.status === 'failed' && msg.errorMessage && !hasMappingWarning && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-red-700 mb-0.5">Failure Reason</p>
                <p className="text-xs text-red-600 break-all">{msg.errorMessage}</p>
              </div>
            </div>
          )}
          {hasMappingWarning && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber-700 mb-0.5">Mapping Warning</p>
                <p className="text-xs text-amber-600 break-all">{msg.errorMessage}</p>
                <p className="text-xs text-amber-700 mt-2">
                  {senderView
                    ? 'You can resend the original payload after checking the mapping setup or retrying later.'
                    : 'The sender can resend the original payload after checking the mapping setup or retrying later.'}
                </p>
              </div>
            </div>
          )}

          {senderView && hasMappingWarning && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-amber-800">Resend original payload</p>
                <p className="text-xs text-amber-700">
                  This creates a new message using the same target and raw payload.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                loading={resending}
                onClick={async () => {
                  setResending(true);
                  setResendResult(null);
                  try {
                    const resentId = await onResend(msg);
                    setResendResult({
                      ok: true,
                      text: `Resent successfully${resentId ? ` — new ID: ${resentId}` : ''}`,
                    });
                  } catch (err: unknown) {
                    const errorMessage = (err as { message?: string }).message ?? 'Failed to resend message';
                    setResendResult({ ok: false, text: errorMessage });
                  } finally {
                    setResending(false);
                  }
                }}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Resend
              </Button>
            </div>
          )}

          {resendResult && (
            <div className={cn(
              'text-sm px-3 py-2 rounded-lg border',
              resendResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700',
            )}>
              {resendResult.text}
            </div>
          )}

          {/* ── d) Payload sections ─────────────────────────────────────── */}
          {visibleRawPayload && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Raw Payload (Original)</p>
                <div className="flex items-center gap-2">
                  {hasFormatTransform && (
                    <span className="text-xs text-indigo-500 font-medium">Source: {fmtLabel(msg.format)}</span>
                  )}
                  <CopyButton text={visibleRawPayload} />
                </div>
              </div>
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs overflow-auto max-h-60 whitespace-pre-wrap">
                {tryPretty(visibleRawPayload)}
              </pre>
            </div>
          )}
          {hasVisibleCdm && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {senderView ? 'Mapped Payload (CDM Output)' : 'CDM Payload (Mapping Input)'}
                </p>
                <CopyButton text={visibleCdmPayload!} />
              </div>
              <pre className={cn(
                'border rounded-lg p-3 text-xs overflow-auto max-h-60 whitespace-pre-wrap',
                emptyCdm ? 'bg-amber-50 border-amber-200' : 'bg-indigo-50 border-indigo-100',
              )}>
                {tryPretty(visibleCdmPayload)}
              </pre>
            </div>
          )}
          {hasVisibleDeliveredPayload && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {admin ? 'Transformed Payload (Receiver Output)' : 'Delivered Payload (Your Format)'}
                </p>
                <div className="flex items-center gap-2">
                  {hasFormatTransform && (
                    <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                      <Zap className="w-3 h-3" />Transformed → {fmtLabel(msg.outputFormat ?? msg.format)}
                    </span>
                  )}
                  <CopyButton text={visibleDeliveredPayload!} />
                </div>
              </div>
              <pre className="border rounded-lg p-3 text-xs overflow-auto max-h-60 whitespace-pre-wrap bg-emerald-50 border-emerald-100">
                {tryPretty(visibleDeliveredPayload)}
              </pre>
            </div>
          )}

          {/* ── e) LLM Trace ──────────────────────────────────────────── */}
          {msg.llmContext?.stages && msg.llmContext.stages.length > 0 && (() => {
            // Admins see all stages.
            // Sender (A) sees only Stage 1 (their format → CDM).
            // Receiver (B) sees only Stage 2 (CDM → their format).
            const allStages = msg.llmContext.stages;
            const visibleStages = admin
              ? allStages
              : msg.sourcePartnerId === myId
                ? allStages.filter(s => s.stage === 1)
                : allStages.filter(s => s.stage === 2);

            if (visibleStages.length === 0) return null;
            return (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Bot className="w-4 h-4 text-indigo-500" />
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">LLM Mapping Trace</p>
                  <span className="text-xs text-gray-400">({visibleStages.length} stage{visibleStages.length > 1 ? 's' : ''})</span>
                </div>
                <div className="space-y-2">
                  {visibleStages.map((stg, i) => (
                    <LlmStageBlock key={i} stg={stg} />
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

/* ── Interfaces ──────────────────────────────────────────────────────────── */
interface Capabilities {
  outboundFormats: string[]; inboundFormats: string[];
  outboundTypes: string[];   inboundTypes: string[];
}

/* ── Message type sample payloads keyed by [messageType][format] ─────────── */
const MSG_SAMPLES: Record<string, Record<string, string>> = {
  order: {
    json: JSON.stringify({
      orderId: 'ORD-CB-2026-1042', orderDate: '2026-03-15T09:30:00Z', status: 'confirmed',
      buyer: { id: 'CAREBRIDGE-001', name: 'CareBridge Pharmacy Network', email: 'edi@carebridge-demo.io' },
      seller: { id: 'MEDICORE-001', name: 'MediCore Systems', email: 'integration@medicore-demo.io' },
      lineItems: [
        { sku: 'MC-IBU-200-100', description: 'MediCore Ibuprofen 200mg 100-count bottle', qty: 240, unitPrice: 18.75 },
        { sku: 'MC-CF-24', description: 'MediCore Cold and Flu Relief 24-count', qty: 180, unitPrice: 24.4 },
      ],
      subtotal: 8892.0, taxRate: 0, taxAmount: 0, shippingFee: 1692.0,
      total: 10584.0, currency: 'USD', paymentTerms: 'NET30', deliveryDate: '2026-03-22',
    }, null, 2),
    xml: `<Order>\n  <OrderId>ORD-CB-2026-1042</OrderId>\n  <Buyer>CareBridge Pharmacy Network</Buyer>\n  <Seller>MediCore Systems</Seller>\n  <LineItems>\n    <Item><SKU>MC-IBU-200-100</SKU><Qty>240</Qty><Price>18.75</Price></Item>\n  </LineItems>\n  <Total>10584.00</Total><Currency>USD</Currency>\n</Order>`,
  },
  purchase_order: {
    'edi-x12': `ISA*00*          *00*          *ZZ*CAREBRIDGE     *ZZ*MEDICORE       *260315*0900*^*00501*000000921*0*P*>~\nGS*PO*CAREBRIDGE*MEDICORE*20260315*0900*921*X*005010~\nST*850*0001~\nBEG*00*SA*PO-CB-2026-1042**20260315~\nN1*BY*CareBridge Pharmacy Network*91*CAREBRIDGE-001~\nN1*SE*MediCore Systems*91*MEDICORE-001~\nPO1*1*240*CS*18.75**BP*CB-IBU-200-100*VP*MC-IBU-200-100~\nPO1*2*180*CS*24.40**BP*CB-CF-24*VP*MC-CF-24~\nPO1*3*120*CS*14.10**BP*CB-VITD-60*VP*MC-VITD-60~\nAMT*TT*10584.00~\nCTT*3~\nSE*10*0001~\nGE*1*1~\nIEA*1*000000001~`,
    xml: `<PurchaseOrder>\n  <PONumber>PO-CB-2026-1042</PONumber>\n  <Buyer>CareBridge Pharmacy Network</Buyer>\n  <Supplier>MediCore Systems</Supplier>\n  <LineItems>\n    <Item><PartNo>CB-IBU-200-100</PartNo><Desc>MediCore Ibuprofen 200mg 100-count bottle</Desc><Qty>240</Qty><UnitPrice>18.75</UnitPrice></Item>\n  </LineItems>\n  <TotalAmount>10584.00</TotalAmount>\n</PurchaseOrder>`,
  },
  invoice: {
    json: JSON.stringify({
      invoice_no: 'MC-INV-2026-1042', inv_date: '2026-03-17', due_date: '2026-04-16',
      item_lines: [
        { sku: 'MC-IBU-200-100', description: 'MediCore Ibuprofen 200mg 100-count bottle', qty: 240, unit_rate: 18.75 },
        { sku: 'MC-CF-24', description: 'MediCore Cold and Flu Relief 24-count', qty: 180, unit_rate: 24.4 },
      ],
      sub_total: 10584.0, tax_rate: 0, tax_amount: 0, gross_total: 10584.0, ccy: 'USD',
      billed_to: 'CareBridge Pharmacy Network', billed_from: 'MediCore Systems',
    }, null, 2),
    xml: `<Invoice>\n  <InvoiceNo>MC-INV-2026-1042</InvoiceNo>\n  <InvDate>2026-03-17</InvDate>\n  <Supplier>MediCore Systems</Supplier>\n  <Buyer>CareBridge Pharmacy Network</Buyer>\n  <LineItems>\n    <Line><SupplierSku>MC-IBU-200-100</SupplierSku><BuyerSku>CB-IBU-200-100</BuyerSku><Qty>240</Qty><UnitPrice>18.75</UnitPrice></Line>\n  </LineItems>\n  <TotalDue>10584.00</TotalDue><Currency>USD</Currency>\n</Invoice>`,
  },
  shipment: {
    xml: `<ShipmentNotice>\n  <ShipmentRef>GT-SHP-2026-2042</ShipmentRef>\n  <OrderRef>PO-CB-2026-1042</OrderRef>\n  <Carrier>GlobalTrade Logistics</Carrier>\n  <ShipDate>2026-03-18</ShipDate>\n  <ETADate>2026-03-19</ETADate>\n  <TemperatureBand>15C-25C</TemperatureBand>\n  <LineItems>\n    <Item><SKU>MC-IBU-200-100</SKU><QtyShipped>240</QtyShipped></Item>\n    <Item><SKU>MC-CF-24</SKU><QtyShipped>180</QtyShipped></Item>\n  </LineItems>\n  <TotalWeight unit="kg">1280</TotalWeight>\n</ShipmentNotice>`,
    edifact: `UNA:+.? '\nUNB+UNOA:1+GLOBALTRADE+CAREBRIDGE+260318:1310+1'\nUNH+1+DESADV:D:96A:UN'\nBGM+351+DESADV-GT-2026-2042+9'\nDTM+137:20260318:102'\nRFF+ON:PO-CB-2026-1042'\nNAD+SE+MEDICORE-001::91++MediCore Systems+200 MedTech Blvd+Boston+MA+02110+US'\nNAD+BY+CAREBRIDGE-001::91++CareBridge Pharmacy Network+450 Wellness Avenue+Chicago+IL+60611+US'\nLIN+1++MC-IBU-200-100:IN'\nQTY+12:240:CS'\nLIN+2++MC-CF-24:IN'\nQTY+12:180:CS'\nCNT+2:2'\nUNT+12+1'\nUNZ+1+1'`,
  },
  payment: {
    json: JSON.stringify({
      mc_payment_ref: 'MC-FIN-2026-1042', request_type: 'RECEIVABLES_FINANCING', value_date: '2026-03-18',
      gross_amt: 10372.32, ccy: 'USD', debit_party: 'MediCore Systems',
      credit_party: 'NexusPay Finance', inv_ref: 'MC-INV-2026-1042',
      payment_method: 'TREASURY_ADVANCE', bank_ref: 'NX-TXN-610421', narration: 'Advance against approved CareBridge invoice',
    }, null, 2),
  },
  remittance: {
    csv: `nx_remit_id,orig_payment_ref,paid_amt,ccy,nx_txn_id,value_date,payer,payee,status\nNX-REM-2026-1042,MC-FIN-2026-1042,10372.32,USD,NX-TXN-610421,2026-03-18,NexusPay Finance,MediCore Systems,settled`,
  },
  shipment_instruction: {
    edifact: `UNA:+.? '\nUNB+UNOA:1+MEDICORE+GLOBALTRADE+260316:0715+1'\nUNH+1+IFTMIN:D:99B:UN'\nBGM+340+IFTMIN-MC-GT-1042+9'\nDTM+137:20260316:102'\nNAD+CZ+MEDICORE-001::91++MediCore Systems'\nNAD+CA+GLOB-001::91++GlobalTrade Logistics'\nLOC+7+USBOS'\nLOC+11+USCHI'\nGODS+1+540+CS+OTC pharmacy replenishment+MC-IBU-200-100'\nUNT+9+1'\nUNZ+1+1'`,
  },
};

const TYPE_COLORS: Record<string, string> = {
  order: 'bg-blue-100 text-blue-700 border-blue-200',
  purchase_order: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  invoice: 'bg-amber-100 text-amber-700 border-amber-200',
  shipment: 'bg-green-100 text-green-700 border-green-200',
  payment: 'bg-purple-100 text-purple-700 border-purple-200',
  remittance: 'bg-pink-100 text-pink-700 border-pink-200',
  shipment_instruction: 'bg-teal-100 text-teal-700 border-teal-200',
  inventory: 'bg-orange-100 text-orange-700 border-orange-200',
  catalogue: 'bg-rose-100 text-rose-700 border-rose-200',
};

const AVATAR_COLORS = [
  'bg-indigo-500', 'bg-blue-500', 'bg-teal-500', 'bg-amber-500', 'bg-rose-500', 'bg-purple-500',
];

/* ── Send Form: visual 3-step wizard ──────────────────────────────────────── */
function SendForm({ onSent }: { onSent: () => void }) {
  const [sendTargets, setSendTargets] = useState<SendTarget[]>([]);
  const [myCapabilities, setMyCapabilities] = useState<Capabilities | null>(null);
  const [targetId, setTargetId] = useState('');
  const [targetCaps, setTargetCaps] = useState<Capabilities | null>(null);
  const [loadingCaps, setLoadingCaps] = useState(false);
  const [msgType, setMsgType] = useState('');
  const [format, setFormat] = useState('');
  const [payload, setPayload] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const myId = getPartnerId() ?? '';

  useEffect(() => {
    Promise.all([
      subscriptionsApi.getSendTargets(),
      mappingsApi.getPartnerCapabilities(myId),
    ]).then(([tRes, cRes]) => {
      setSendTargets((tRes.data as { data: SendTarget[] }).data ?? []);
      setMyCapabilities((cRes.data as { data: Capabilities }).data ?? null);
    }).catch(() => {});
  }, [myId]);

  // When target changes, fetch their capabilities
  useEffect(() => {
    if (!targetId) { setTargetCaps(null); setMsgType(''); setFormat(''); return; }
    setLoadingCaps(true);
    mappingsApi.getPartnerCapabilities(targetId)
      .then(r => setTargetCaps((r.data as { data: Capabilities }).data ?? null))
      .catch(() => setTargetCaps(null))
      .finally(() => setLoadingCaps(false));
    setMsgType(''); setFormat(''); setPayload('');
  }, [targetId]);

  // When msgType changes, pick best format and pre-fill payload
  useEffect(() => {
    if (!msgType) { setFormat(''); setPayload(''); return; }
    // prefer a format that has a sample
    const samples = MSG_SAMPLES[msgType] ?? {};
    const preferredFormats = availableFormats;
    const best = preferredFormats.find(f => samples[f]) ?? preferredFormats[0] ?? 'json';
    setFormat(best);
    setPayload(samples[best] ?? FORMAT_EXAMPLES[best] ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgType]);

  // When format changes, update payload
  useEffect(() => {
    if (!format || !msgType) return;
    const sample = (MSG_SAMPLES[msgType] ?? {})[format];
    if (sample) setPayload(sample);
    else setPayload(FORMAT_EXAMPLES[format] ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format]);

  // Message types I can send that the target can receive (intersection)
  const myOutTypes = myCapabilities?.outboundTypes ?? [];
  const targetInTypes = targetCaps?.inboundTypes ?? [];
  const matchedTypes = myOutTypes.filter(t => targetInTypes.includes(t));
  const otherMyTypes = myOutTypes.filter(t => !targetInTypes.includes(t));
  const targetOnlyTypes = targetInTypes.filter(t => !myOutTypes.includes(t));

  // Formats available for selected msgType
  const myOutFormatsForType = !msgType ? [] : (myCapabilities?.outboundFormats ?? []);
  const targetInFormatsForType = !msgType ? [] : (targetCaps?.inboundFormats ?? []);
  const availableFormats = msgType
    ? [...new Set([...myOutFormatsForType, ...targetInFormatsForType, ...FORMATS])]
    : FORMATS;

  const hasAiMapping = !!(msgType && format &&
    myCapabilities?.outboundFormats.includes(format) &&
    targetCaps?.inboundFormats.includes(format));

  const selectedTarget = sendTargets.find(t => t.partnerId === targetId);

  const sendMsg = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = payload.trim();
    if (!targetId || !trimmed || trimmed === '{}' || trimmed === '[]') {
      setResult({ ok: false, text: 'Payload cannot be empty. Please enter a valid message.' });
      return;
    }
    setSending(true); setResult(null);
    try {
      const body = format === 'json' ? JSON.parse(payload) : payload;
      const res = await integrationsApi.sendMessage(targetId, body, format);
      const d = res.data as { data?: { messageId?: string } };
      setResult({ ok: true, text: `✓ Message sent — ID: ${d.data?.messageId ?? 'ok'}` });
      setTimeout(onSent, 800);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? (err as { message?: string }).message ?? 'Failed to send';
      setResult({ ok: false, text: msg });
    } finally {
      setSending(false);
    }
  };

  if (sendTargets.length === 0) {
    return (
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>No active subscribers yet. Partners must subscribe to you and be approved before you can send them messages.</span>
      </div>
    );
  }

  return (
    <form onSubmit={sendMsg} className="space-y-5">
      {/* Step 1: Partner selection */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white text-xs font-bold">1</span>
          Select Target Partner
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {sendTargets.map((t, i) => {
            const isSelected = t.partnerId === targetId;
            const initials = t.companyName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
            const avatarColor = AVATAR_COLORS[i % AVATAR_COLORS.length];
            return (
              <button
                key={t.partnerId}
                type="button"
                onClick={() => setTargetId(isSelected ? '' : t.partnerId)}
                className={cn(
                  'flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all',
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                    : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                )}
              >
                <div className={cn('w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm', avatarColor)}>
                  {initials}
                </div>
                <span className="text-xs font-semibold text-gray-800 leading-tight">{t.companyName}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2: Message type (shows after partner selected) */}
      {targetId && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white text-xs font-bold">2</span>
            Message Type
            {loadingCaps && <span className="text-xs text-gray-400 font-normal ml-1">Loading…</span>}
          </p>

          {!loadingCaps && (
            <div className="space-y-3">
              {/* Matched: I can send AND they can receive (with AI mapping) */}
              {matchedTypes.length > 0 && (
                <div>
                  <p className="text-xs text-green-700 font-medium mb-1.5 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5" />AI-mapped — I can send, {selectedTarget?.companyName.split(' ')[0]} can receive
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {matchedTypes.map(t => (
                      <button key={t} type="button" onClick={() => setMsgType(t === msgType ? '' : t)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all flex items-center gap-1.5',
                          msgType === t ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : TYPE_COLORS[t] ?? 'bg-gray-100 text-gray-700 border-gray-200 hover:border-indigo-300'
                        )}>
                        <Zap className="w-3 h-3" />{t.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* My outbound only (no inbound schema on their side) */}
              {otherMyTypes.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-1.5">I can send (no inbound schema on their side)</p>
                  <div className="flex flex-wrap gap-2">
                    {otherMyTypes.map(t => (
                      <button key={t} type="button" onClick={() => setMsgType(t === msgType ? '' : t)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                          msgType === t ? 'bg-gray-700 text-white border-gray-700' : 'border-gray-200 text-gray-500 hover:border-gray-400'
                        )}>
                        {t.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Target inbound only */}
              {targetOnlyTypes.length > 0 && (
                <div>
                  <p className="text-xs text-amber-600 font-medium mb-1.5">
                    {selectedTarget?.companyName.split(' ')[0]} expects (I have no outbound schema yet)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {targetOnlyTypes.map(t => (
                      <button key={t} type="button" onClick={() => setMsgType(t === msgType ? '' : t)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                          msgType === t ? 'bg-amber-600 text-white border-amber-600' : 'border-amber-200 text-amber-600 hover:border-amber-400'
                        )}>
                        {t.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {matchedTypes.length === 0 && otherMyTypes.length === 0 && targetOnlyTypes.length === 0 && (
                <p className="text-xs text-gray-400 italic">No schema capabilities found. You can still send an ad-hoc message below.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Format + payload (shows after partner selected) */}
      {targetId && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white text-xs font-bold">3</span>
            Format &amp; Payload
          </p>

          {/* Format selector */}
          <div className="flex flex-wrap gap-2 mb-3">
            {FORMATS.map(f => {
              const isMine = myCapabilities?.outboundFormats.includes(f);
              const isTheirs = targetCaps?.inboundFormats.includes(f);
              const hasSample = !!(MSG_SAMPLES[msgType ?? ''] ?? {})[f];
              return (
                <button key={f} type="button" onClick={() => setFormat(f)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                    format === f ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
                  )}>
                  {FORMAT_LABELS[f]}
                  {isMine && isTheirs && <Zap className={cn('w-3 h-3', format === f ? 'text-indigo-200' : 'text-green-500')} />}
                  {hasSample && !(isMine && isTheirs) && (
                    <span className={cn('text-xs', format === f ? 'text-indigo-200' : 'text-gray-400')}>sample</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Mapping hint banner */}
          {hasAiMapping ? (
            <div className="mb-3 flex items-center gap-2 text-xs px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-green-700">
              <Zap className="w-3.5 h-3.5 shrink-0" />
              <span>
                <span className="font-semibold">AI mapping active</span> — your {FORMAT_LABELS[format]} outbound schema will transform this to CDM,
                then {selectedTarget?.companyName.split(' ')[0]}'s inbound schema will reshape it for their system.
              </span>
            </div>
          ) : targetId ? (
            <div className="mb-3 flex items-center gap-2 text-xs px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-500">
              <Activity className="w-3.5 h-3.5 shrink-0" />
              <span>No mapping schema for this format — payload will be delivered as-is.{' '}
                <a href="/mappings" className="text-indigo-500 hover:underline">Set up schema →</a>
              </span>
            </div>
          ) : null}

          {/* Trade lane visualizer */}
          {selectedTarget && msgType && (
            <div className="mb-3 flex items-center gap-2 p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
              <span className="font-semibold">You</span>
              <ArrowRight className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className={cn('px-2 py-0.5 rounded border text-xs font-medium', TYPE_COLORS[msgType] ?? 'bg-gray-100 text-gray-600 border-gray-200')}>
                {msgType.replace(/_/g, ' ')} · {FORMAT_LABELS[format] ?? format.toUpperCase()}
              </span>
              <ArrowRight className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="font-semibold">{selectedTarget.companyName}</span>
            </div>
          )}

          {/* Payload textarea */}
          <Textarea
            label="Payload"
            value={payload}
            onChange={e => setPayload(e.target.value)}
            rows={6}
            className="font-mono text-xs"
            required
          />
        </div>
      )}

      {result && (
        <div className={cn('text-sm px-3 py-2 rounded-lg border', result.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700')}>
          {result.text}
        </div>
      )}

      {targetId && (
        <Button type="submit" loading={sending} disabled={!targetId || !payload.trim()}>
          <Send className="w-4 h-4 mr-1.5" />Send Message
        </Button>
      )}
    </form>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Page
══════════════════════════════════════════════════════════════════════════════ */
export default function IntegrationsPage() {
  const myId = getPartnerId() ?? '';
  const admin = isAdmin();
  const [messages, setMessages] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Message | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Filters
  const [direction, setDirection] = useState<'all' | 'sent' | 'received'>('all');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFormat, setFilterFormat] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setDebouncedSearch(search), 400);
  }, [search]);

  // Load stats once
  useEffect(() => {
    integrationsApi.getStats()
      .then(r => {
        const d = r.data as { data?: { byStatus: Record<string, number> } };
        if (d.data?.byStatus) {
          const s = d.data.byStatus;
          const total = Object.values(s).reduce((a, b) => a + b, 0);
          setStats({
            total,
            delivered: (s['delivered'] ?? 0) + (s['received'] ?? 0),
            failed: (s['failed'] ?? 0) + (s['dead_lettered'] ?? 0),
            processing: s['processing'] ?? 0,
          });
        }
      })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    integrationsApi.listMessages({
      direction, status: filterStatus || undefined, format: filterFormat || undefined,
      search: debouncedSearch || undefined, from: from || undefined, to: to || undefined,
      limit: PAGE_SIZE, offset: page * PAGE_SIZE,
    }).then(r => {
      const res = r.data as { data: Message[]; total: number };
      setMessages(res.data ?? []);
      setTotal(res.total ?? 0);
    }).finally(() => setLoading(false));
  }, [direction, filterStatus, filterFormat, debouncedSearch, from, to, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  // Stats — prefer API response; fall back to counting current page
  const derivedStats: Stats = stats ?? {
    total,
    delivered: messages.filter(m => m.status === 'delivered').length,
    failed: messages.filter(m => m.status === 'failed' || m.status === 'dead_lettered').length,
    processing: messages.filter(m => m.status === 'processing').length,
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      {selected && (
        <DetailPanel
          msg={selected}
          myId={myId}
          admin={admin}
          onClose={() => setSelected(null)}
          onResend={async (message) => {
            const body = message.format === 'json' ? JSON.parse(message.rawPayload ?? '{}') : (message.rawPayload ?? '');
            const response = await integrationsApi.sendMessage(message.targetPartnerId, body, message.format);
            const data = response.data as { data?: { messageId?: string } };
            await load();
            return data.data?.messageId;
          }}
        />
      )}

      {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
            <p className="text-gray-500 text-sm mt-1">
              {admin ? 'Platform-wide message monitoring and troubleshooting across all partner exchanges' : 'Send, track and inspect partner messages'}
            </p>
          </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${autoRefresh ? 'bg-green-50 border-green-300 text-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
          >
            {autoRefresh ? '⏱ Auto-refresh on' : 'Auto-refresh'}
          </button>
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button>
        </div>
      </div>

      {/* Send form */}
      {admin ? (
        <div className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <Bot className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-indigo-800">Admin monitoring view</p>
            <p className="text-xs text-indigo-700 mt-0.5">
              Sending messages is disabled here so the platform admin does not behave like a trading partner. Use this page to monitor, filter, and inspect live exchanges.
            </p>
          </div>
        </div>
      ) : (
        <Card title="Send a Message">
          <SendForm onSent={load} />
        </Card>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {(['all', 'sent', 'received'] as const).map(d => (
              <button key={d} onClick={() => { setDirection(d); setPage(0); }}
                className={`px-4 py-1.5 font-medium capitalize transition-colors ${direction === d ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {d === 'sent' ? <><ArrowUpRight className="w-3.5 h-3.5 inline mr-1" />Sent</> : d === 'received' ? <><ArrowDownLeft className="w-3.5 h-3.5 inline mr-1" />Received</> : 'All'}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search message content…"
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>}
          </div>

          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(0); }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-600">
            <option value="">All statuses</option>
            {STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={filterFormat} onChange={e => { setFilterFormat(e.target.value); setPage(0); }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-600">
            <option value="">All formats</option>
            {FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
          </select>

          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(0); }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(0); }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />

          {(filterStatus || filterFormat || search || from || to) && (
            <button onClick={() => { setFilterStatus(''); setFilterFormat(''); setSearch(''); setFrom(''); setTo(''); setPage(0); }}
              className="text-xs text-red-500 hover:text-red-700 font-medium">Clear filters</button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Messages" value={stats?.total ?? total} colorCls="bg-gray-50 border-gray-200 text-gray-700" icon={<Package className="w-6 h-6 text-gray-400" />} />
        <StatCard label="Delivered" value={derivedStats.delivered} colorCls="bg-green-50 border-green-200 text-green-800" icon={<CheckCircle className="w-6 h-6 text-green-400" />} />
        <StatCard label="Failed" value={derivedStats.failed} colorCls="bg-red-50 border-red-200 text-red-800" icon={<AlertCircle className="w-6 h-6 text-red-400" />} />
        <StatCard label="Processing" value={derivedStats.processing} colorCls="bg-amber-50 border-amber-200 text-amber-800" icon={<Activity className="w-6 h-6 text-amber-400" />} />
      </div>

      {/* Message log */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">
            Message Log <span className="text-gray-400 font-normal text-sm ml-1">({total} total)</span>
          </h2>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">←</button>
              <span className="text-gray-500">Page {page + 1} / {totalPages}</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">→</button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-12">Loading…</div>
        ) : messages.length === 0 ? (
          <Card><div className="text-center py-8 text-gray-400">No messages match your filters.</div></Card>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['', 'Message ID', 'From', 'To', 'Format', 'Status', 'Mapping', 'Retries', 'Timestamp', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {messages.map(m => (
                  <tr key={m.id} onClick={() => setSelected(m)} className="hover:bg-indigo-50 cursor-pointer transition-colors">
                    <td className="px-3 py-3 w-6">
                      {admin
                        ? <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
                        : m.sourcePartnerId === myId
                          ? <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" />
                          : <ArrowDownLeft className="w-3.5 h-3.5 text-green-500" />}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{m.id.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[120px] truncate" title={m.sourcePartnerId}>
                      {m.sourcePartnerName ?? m.sourcePartnerId.slice(0, 8) + '…'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[120px] truncate" title={m.targetPartnerId}>
                      {m.targetPartnerName ?? m.targetPartnerId.slice(0, 8) + '…'}
                    </td>
                    <td className="px-4 py-3">
                      <FormatBadge format={m.format} outputFormat={m.outputFormat} schemaId={m.schemaId} />
                    </td>
                     <td className="px-4 py-3">
                       <Badge
                          label={!admin && m.status === 'delivered' && m.targetPartnerId === myId ? 'received' : m.status}
                          className={statusColor(m.status)}
                        />
                       <div className="mt-1">
                         <MappingStatusBadge msg={m} />
                       </div>
                       {m.status === 'failed' && m.errorMessage && (
                         <p className="text-xs text-red-500 mt-0.5 max-w-[160px] truncate" title={m.errorMessage}>
                           {m.errorMessage.slice(0, 60)}{m.errorMessage.length > 60 ? '…' : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <MappingBadge schemaId={m.schemaId} cdmPayload={m.cdmPayload} />
                    </td>
                    <td className="px-4 py-3 text-gray-500">{m.retries}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDateTime(m.createdAt)}</td>
                    <td className="px-4 py-3 text-gray-300"><ChevronRight className="w-4 h-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
