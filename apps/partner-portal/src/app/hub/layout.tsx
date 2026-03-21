'use client';
import { PartnerRouteLayout } from '@/components/layout/PartnerRouteLayout';

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return <PartnerRouteLayout>{children}</PartnerRouteLayout>;
}
