import ScrollSentinel from '@/components/ScrollSentinel';

/**
 * Layout for pages that don't have a search bar in page flow (listing detail, favorites, etc).
 */
export default function PillOnlyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ScrollSentinel />
      {children}
    </>
  );
}
