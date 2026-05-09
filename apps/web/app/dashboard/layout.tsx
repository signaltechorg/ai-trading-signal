import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { readSessionFromCookies } from '../../lib/user-session';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await readSessionFromCookies();
  if (!session?.userId) redirect('/signin?next=%2Fdashboard');
  return <>{children}</>;
}
