import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export const statusColor = (status: string) => {
  const map: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    active: 'bg-green-100 text-green-800',
    suspended: 'bg-red-100 text-red-800',
    rejected: 'bg-red-100 text-red-800',
    terminated: 'bg-gray-100 text-gray-600',
    requested: 'bg-blue-100 text-blue-800',
    delivered: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    dead_lettered: 'bg-red-200 text-red-900',
    processing: 'bg-blue-100 text-blue-800',
    received: 'bg-gray-100 text-gray-600',
    auto_approved: 'bg-green-100 text-green-800',
    pending_review: 'bg-yellow-100 text-yellow-800',
    drift_suspected: 'bg-orange-100 text-orange-800',
  };
  return map[status] ?? 'bg-gray-100 text-gray-600';
};

// ─── JWT helpers (client-side only) ──────────────────────────────────────────

interface TokenPayload { partnerId?: string; sub?: string; scopes?: string[] }

function decodeToken(): TokenPayload | null {
  try {
    const token = localStorage.getItem('access_token');
    if (!token) return null;
    return JSON.parse(atob(token.split('.')[1])) as TokenPayload;
  } catch { return null; }
}

export function getPartnerId(): string | null {
  const p = decodeToken();
  return p ? (p.partnerId ?? p.sub ?? null) : null;
}

export function getScopes(): string[] {
  return decodeToken()?.scopes ?? [];
}

export function isAdmin(): boolean {
  return getScopes().includes('admin');
}
