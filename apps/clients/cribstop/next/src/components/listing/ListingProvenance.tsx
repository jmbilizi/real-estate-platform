import type { ListingSource } from '@cribstop/property-contracts';
import { formatDate } from '@/lib/format';
import { formatListingProvenance } from '@/lib/listing-format';

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
 *
 * The sentences themselves are `formatListingProvenance`, because the share text and the link
 * preview publish the same claim and must not be able to word it differently. `internal` names the
 * site rather than the brokerage: PRD §6.2 counts owner-claimed and FSBO rows as internal, so
 * naming Real Broker, LLC as the source would assert that we supplied a listing its owner
 * supplied. Brokerage identification is a separate obligation, carried unconditionally by the
 * attribution block and the footer.
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
  const sentence = formatListingProvenance(source);
  if (sentence === null) return null;

  return (
    <p className={`text-xs leading-relaxed text-ink-muted ${className}`}>
      {`${sentence} Data last updated: ${formatDate(lastUpdated)}.`}
    </p>
  );
}
