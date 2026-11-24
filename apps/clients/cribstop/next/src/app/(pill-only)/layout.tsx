import ScrollSentinel from '@/components/ScrollSentinel';

/**
 * Layout for the account, saved and static pages. `ScrollSentinel` mounts the header search pill.
 */
export default function PillOnlyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ScrollSentinel />
      {children}
    </>
  );
}
