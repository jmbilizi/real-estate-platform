import { AgentLeadsSkeleton } from '@/components/agent/AgentSkeletons';

/** Shown while the layout checks the caller's role and profile. */
export default function AgentLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <AgentLeadsSkeleton />
    </div>
  );
}
