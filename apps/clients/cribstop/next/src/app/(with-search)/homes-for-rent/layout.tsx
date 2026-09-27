import ScrollSentinel from '@/components/ScrollSentinel';

/**
 * Layout for the search results page.
 */
export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ScrollSentinel />
      {children}
    </>
  );
}
