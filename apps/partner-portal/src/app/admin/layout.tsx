'use client';
import { AdminRouteLayout } from '@/components/layout/AdminRouteLayout';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminRouteLayout>{children}</AdminRouteLayout>;
}
