'use client';
import { PartnerRouteLayout } from '@/components/layout/PartnerRouteLayout';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <PartnerRouteLayout>{children}</PartnerRouteLayout>;
}
