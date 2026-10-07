import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { loadAgentGate } from '@/lib/api/agent-server';

export const metadata: Metadata = {
  title: 'My leads',
  robots: { index: false, follow: false },
};

// The gate reads the session cookie, so the agent area is never static.
export const dynamic = 'force-dynamic';

/**
 * The agent area. Anyone without the Agent role and an active profile gets the 404 page, not a
 * 403 and not a login prompt, so the area does not confirm that it exists.
 */
export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const gate = await loadAgentGate();
  if (gate.canRefresh) redirect('/api/staff/refresh?to=agent');
  if (!gate.allowed) notFound();
  return <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">{children}</div>;
}
