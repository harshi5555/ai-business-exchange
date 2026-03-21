'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { partnersApi, subscriptionsApi } from '@/lib/api';
import { isAdmin, getPartnerId } from '@/lib/utils';
import { useTheme } from '@/components/ThemeProvider';
import {
  LayoutDashboard, Users, Link2, Send, Cpu, Bot, LogOut, Zap, Settings, CreditCard, Building2, Network, ShieldCheck,
} from 'lucide-react';

import { APP_VERSION, LAST_UPDATED } from '@/lib/version';

const partnerNav = [
  { href: '/dashboard',      label: 'Dashboard',         icon: LayoutDashboard },
  { href: '/partners',       label: 'Partner Catalog',   icon: Users },
  { href: '/subscriptions',  label: 'Subscriptions',     icon: Link2 },
  { href: '/hub',            label: 'Integration Hub',   icon: Network },
  { href: '/integrations',   label: 'Messages',          icon: Send },
  { href: '/mappings',       label: 'Schema Mapping',    icon: Cpu },
  { href: '/billing',        label: 'Billing',           icon: CreditCard },
  { href: '/settings',       label: 'Settings',          icon: Settings },
];

const adminNav = [
  { href: '/dashboard',      label: 'Dashboard',         icon: LayoutDashboard },
  { href: '/partners',       label: 'Partners',          icon: Users },
  { href: '/integrations',   label: 'Messages',          icon: Send },
  { href: '/admin',          label: 'Admin Settings',    icon: Settings },
  { href: '/admin/billing',  label: 'Billing Admin',     icon: CreditCard },
  { href: '/agents',         label: 'Agent Monitor',     icon: Bot },
];

interface PartnerProfile { name: string; contactEmail: string }
interface Sub { subscriberPartnerId: string; providerPartnerId: string; status: string }

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { platformBranding } = useTheme();
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [admin, setAdmin] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    setAdmin(isAdmin());
    if (isAdmin()) return;

    const id = getPartnerId();
    if (!id) return;
    partnersApi.get(id)
      .then(r => {
        const p = (r.data as { data: PartnerProfile }).data;
        setProfile({ name: p.name, contactEmail: p.contactEmail });
      })
      .catch(() => {});

    // Count subscriptions awaiting MY approval (I am the provider)
    subscriptionsApi.list()
      .then(r => {
        const subs = (r.data as { data: Sub[] }).data ?? [];
        const count = subs.filter(s => s.status === 'requested' && s.providerPartnerId === id).length;
        setPendingApprovals(count);
      })
      .catch(() => {});
  }, []);

  const logout = () => {
    localStorage.removeItem('access_token');
    router.push('/login');
  };

  return (
    <aside className="flex h-screen w-64 flex-col bg-gray-900 text-white">
      {/* Logo / Brand */}
      <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-800">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600 shrink-0 overflow-hidden">
          {platformBranding.logoUrl
            ? <img src={platformBranding.logoUrl} alt="logo" className="w-full h-full object-contain" />
            : <Zap className="w-4 h-4 text-white" />}
        </div>
        <span className="font-bold text-lg tracking-tight truncate">
          {platformBranding.platformName || 'BusinessX'}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {(admin ? adminNav : partnerNav).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              pathname.startsWith(href)
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1">{label}</span>
            {!admin && href === '/subscriptions' && pendingApprovals > 0 && (
              <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                {pendingApprovals}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-gray-800 space-y-1">
        {!admin && (
          <Link href="/agents" className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors', pathname.startsWith('/agents') ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white')}>
            <Bot className="w-4 h-4 shrink-0" />
            Agent Monitor
          </Link>
        )}

        {admin ? (
          <div className="mt-2 mx-1 rounded-lg bg-gray-800 px-3 py-2.5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium text-white truncate">Platform Admin</p>
              <p className="text-xs text-gray-400 truncate">Platform operator</p>
            </div>
          </div>
        ) : profile && (
          <div className="mt-2 mx-1 rounded-lg bg-gray-800 px-3 py-2.5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
              {profile.name[0].toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium text-white truncate">{profile.name}</p>
              <p className="text-xs text-gray-400 truncate">{profile.contactEmail}</p>
            </div>
            <Building2 className="w-3.5 h-3.5 text-gray-500 shrink-0 ml-auto" />
          </div>
        )}

        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors">
          <LogOut className="w-4 h-4 shrink-0" />
          Sign out
        </button>

        {/* Version */}
        <div className="mt-2 px-3 py-1.5 flex items-center justify-between">
          <span className="text-xs text-gray-600 font-mono">v{APP_VERSION}</span>
          <span className="text-xs text-gray-600">{LAST_UPDATED}</span>
        </div>
      </div>
    </aside>
  );
}
