import Link from 'next/link';
import { BRAND } from '@/lib/brand';

/**
 * The site brand in the header: a small rounded square in the brand color with a handwritten "CS"
 * in white, in the style of the LinkedIn mark (stakeholder decision 2026-11-24). The same mark at
 * every width. It replaces the "CRIBSTOP at Real Broker, LLC" text lockup in the header, which
 * used too much of the row.
 *
 * The letters are drawn strokes, not a font: the app loads no web font, and a system script font
 * is a different face on each device.
 *
 * The link name is "<siteName> at <brokerage>", so the two names stay in the server HTML and a
 * screen reader reads them. The visible brokerage name is in the footer of each page.
 */
export default function BrandMark() {
  return (
    <Link
      href="/"
      aria-label={`${BRAND.siteName} at ${BRAND.brokerage}: home`}
      className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[5px] bg-brand text-white before:absolute before:-inset-1 before:content-['']"
    >
      <svg
        aria-hidden="true"
        data-brand-mark="cs"
        viewBox="0 0 36 36"
        className="h-9 w-9"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* C */}
        <path d="M16.8 12.6c-.6-2.6-4-3.4-6.6-.8-3 3-4 8.400-2 11.400 1.900 2.900 5.800 2.700 8.400-.700" />
        {/* S, joined to the C by its lead-in stroke */}
        <path d="M28.600 11.900c-1.100-2.500-4.900-2.700-6.700-.400-1.700 2.200-.100 4.300 2.300 5.500 2.600 1.300 4.100 3.500 2.400 5.900-1.900 2.600-6.300 2.300-8.200-1.200" />
      </svg>
    </Link>
  );
}
