import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadStaffRoles } from '@/lib/api/staff-server';
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
  if (!hasLeadDeskRole(await loadStaffRoles())) notFound();
  return <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</div>;
}
