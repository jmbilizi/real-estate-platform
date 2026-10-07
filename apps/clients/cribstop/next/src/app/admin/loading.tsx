import { LeadsListSkeleton } from '@/components/staff/LeadSkeletons';

/** Shown while the layout checks the caller's roles. */
export default function AdminLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <LeadsListSkeleton />
    </div>
  );
}
