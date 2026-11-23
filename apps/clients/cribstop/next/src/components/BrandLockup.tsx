import Link from 'next/link';
import { BRAND } from '@/lib/brand';

/**
 * The site brand: the CRIBSTOP wordmark, then "at Real Broker, LLC" (#1048, stakeholder ruling
 * 2026-11-18). One component for the phone line and the desktop header, so both read the same.
 * The phone line is one row. The desktop header stacks the two parts so the lockup fits beside the
 * centered tabs at 768px.
 *
 * Compliance (PRD §6.1, research in #946):
 * - The licensed name is `BRAND.brokerage`, in ink, semibold, never below 12px. That meets "clearly
 *   and legibly displayed" (VA 18VAC135-20-190) and "readily visible color and typeface" (NAR 7.58).
 *   No rule sets a size ratio between the two names.
 * - "at" is the only word between the names, with no image or symbol (MD COMAR 09.11.02.01G(5)).
 * - It renders in the server HTML, in the first 25 percent of the page (G(4)).
 */
export default function BrandLockup({ variant }: { variant: 'nav' | 'line' }) {
  const nav = variant === 'nav';
  return (
    <Link
      href="/"
      className={`relative flex whitespace-nowrap leading-none before:absolute before:-inset-x-2 before:-inset-y-2 before:content-[''] ${
        nav ? 'flex-col items-start gap-1' : 'items-baseline gap-1'
      }`}
    >
      <span
        className={`font-display font-bold uppercase tracking-tight text-ink ${nav ? 'text-[22px]' : 'text-base'}`}
      >
        {BRAND.siteWordmark[0]}
        <span className="text-brand">{BRAND.siteWordmark[1]}</span>
      </span>{' '}
      <span className={`flex items-baseline gap-1 ${nav ? 'text-[13px]' : 'text-xs'}`}>
        <span className="text-ink-muted">at</span>{' '}
        <span className="font-semibold text-ink">{BRAND.brokerage}</span>
      </span>
    </Link>
  );
}
