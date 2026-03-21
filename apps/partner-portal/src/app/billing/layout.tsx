'use client';
import { PartnerRouteLayout } from '@/components/layout/PartnerRouteLayout';

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return <PartnerRouteLayout adminRedirectPath="/admin/billing">{children}</PartnerRouteLayout>;
}
