import ScrollSentinel from '@/components/ScrollSentinel';

/**
 * Layout for the property page (#382). `ScrollSentinel` mounts `CompactSearchBar`, and this route
 * sits outside every route group. See the identical note in `listing/[id]/layout.tsx`.
 */
export default function PropertyPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ScrollSentinel />
      {children}
    </>
  );
}
