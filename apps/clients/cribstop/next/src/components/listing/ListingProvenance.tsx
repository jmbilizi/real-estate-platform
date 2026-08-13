import type { ListingSource } from '@cribstop/property-contracts';
import { BRAND } from '@/lib/brand';
import { formatDate } from '@/lib/format';

/**
 * Per-listing data provenance, driven off **that row's** `source`.
 *
 * The detail page used to render "Information provided by Bright MLS. Deemed reliable but not
 * guaranteed." for every listing. Every row is `source='internal'` today and there is no Bright
 * content licence yet (#33), so that sentence was a false statement of MLS provenance on data
 * Bright never supplied — the class of misrepresentation that puts a brokerage's MLS participation
 * at risk, and the opposite of the trust position the product is built on (PRD §6.2/§6.3).
 *
 * A row-level truth needs a row-level condition. This is driven by the `source` field on the API
 * response and never by a build flag, an env var or a default:
 *
 * - `brightMLS` → the Bright provenance line.
 * - `internal`  → our own attribution, which is the accurate statement for a row we hold.
 * - `other`     → neither Bright's nor ours.
 */
export default function ListingProvenance({
  source,
  lastUpdated,
  className = '',
}: {
  source: ListingSource;
  lastUpdated: string;
  className?: string;
}) {
  if (source === 'other') return null;

  const updated = `Data last updated: ${formatDate(lastUpdated)}.`;

  return (
    <p className={`text-xs leading-relaxed text-ink-muted ${className}`}>
      {source === 'brightMLS'
        ? `Information provided by Bright MLS. Deemed reliable but not guaranteed. ${updated}`
        : `Listing information provided by ${BRAND.brokerage}. Deemed reliable but not guaranteed. ${updated}`}
    </p>
  );
}
