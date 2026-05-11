/**
 * Shared layout for the (with-search) route group.
 * Each sub-route manages its own ScrollSentinel so they can choose
 * scroll-based vs alwaysPill behaviour independently.
 */
export default function WithSearchLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
