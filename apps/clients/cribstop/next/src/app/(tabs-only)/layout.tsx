import ScrollSentinel from '@/components/ScrollSentinel';

/**
 * Layout for pages that always show header tabs (no forced pill mode).
 * Includes ScrollSentinel in normal mode — search bar in page flow,
 * pill appears only when scrolled past it (no transition on navigation).
 */
export default function TabsOnlyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ScrollSentinel />
      {children}
    </>
  );
}
