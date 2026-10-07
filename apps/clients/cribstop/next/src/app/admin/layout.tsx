import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { loadStaffGate } from '@/lib/api/staff-server';
import { hasLeadDeskRole } from '@/lib/staff-leads';

export const metadata: Metadata = {
  title: 'Lead desk',
  robots: { index: false, follow: false },
};

// The gate reads the session cookie, so the staff area is never static.
export const dynamic = 'force-dynamic';

/**
 * The staff area. Anyone without a lead desk role gets the 404 page, not a 403 and not a login
 * prompt, so the area does not confirm that it exists. Nothing in the public nav links here.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const gate = await loadStaffGate();
  if (gate.canRefresh) redirect('/api/staff/refresh');
  if (!hasLeadDeskRole(gate.roles)) notFound();
  const link =
    'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-ink hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink';
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <nav aria-label="Lead desk" className="mb-4 flex gap-1">
        <Link href="/admin/leads" className={link}>
          Requests
        </Link>
        <Link href="/admin/agents" className={link}>
          Agents
        </Link>
      </nav>
      {children}
    </div>
  );
}
