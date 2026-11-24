import ScrollSentinel from '@/components/ScrollSentinel';

/**
 * Layout for the Services and Connect tabs. `ScrollSentinel` mounts the header search pill.
 */
export default function TabsOnlyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ScrollSentinel />
      {children}
    </>
  );
}
