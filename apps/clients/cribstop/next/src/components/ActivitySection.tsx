import type { ReactNode } from 'react';

/**
 * One product section (Homes, Services or Connect) of an account activity page:
 * `/account/favorites` and `/account/recently-viewed`.
 */
export function ActivitySection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="mt-10 first-of-type:mt-8">
      <h2 id={`${id}-heading`} className="font-display text-xl font-bold tracking-tight text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The body of a section whose product has no activity to show yet. It promises no action. */
export function ActivityNotYet({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 rounded-lg border border-dashed border-surface-border bg-surface-alt/60 px-5 py-6 text-sm text-ink-muted">
      {children}
    </p>
  );
}
