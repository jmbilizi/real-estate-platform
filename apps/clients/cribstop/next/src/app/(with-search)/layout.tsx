/**
 * Shared layout for the (with-search) route group.
 * Each sub-route mounts its own `ScrollSentinel`, which mounts the header search pill.
 */
export default function WithSearchLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
