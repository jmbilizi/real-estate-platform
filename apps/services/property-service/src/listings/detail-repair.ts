import { type ListingDetail, listingDetailSchema } from '@cribstop/property-contracts';

/** #564 scalar fields. A value that fails its shape becomes `null`. */
const REPAIRABLE_SCALARS: ReadonlySet<string> = new Set([
  'taxAnnualAmount',
  'taxYear',
  'hoaFee',
  'hoaFeeFrequency',
  'virtualTourUrl',
  'listAgentPhone',
  'listAgentEmail',
]);

const FACT_GROUPS = [
  'parking',
  'heating',
  'cooling',
  'appliances',
  'basement',
  'flooring',
  'interior',
  'exterior',
] as const;

type Mutable = Record<string, unknown>;

/**
 * Parses a listing detail. A bad MLS value in a detail-only field (#564) must not fail the page.
 * That field becomes `null`, or the fact group becomes `null`, or the photo caption becomes `null`.
 * An issue anywhere else still throws, because it means the SQL and the contract disagree.
 * The log names the field and never the value, because feed text can carry an address.
 */
export function parseListingDetail(candidate: unknown): ListingDetail {
  const first = listingDetailSchema.safeParse(candidate);
  if (first.success) {
    return first.data;
  }

  const repaired = structuredClone(candidate) as { listing?: Mutable };
  const listing = repaired.listing;
  const fields = new Set<string>();
  let repairable = listing !== undefined && listing !== null && typeof listing === 'object';

  for (const issue of first.error.issues) {
    const [root, key, index, leaf] = issue.path;
    if (!repairable || root !== 'listing' || listing === undefined) {
      repairable = false;
      break;
    }
    if (typeof key === 'string' && REPAIRABLE_SCALARS.has(key)) {
      listing[key] = null;
      fields.add(key);
    } else if (key === 'facts') {
      const facts = listing['facts'];
      if (typeof index === 'string' && facts !== null && typeof facts === 'object') {
        (facts as Mutable)[index] = null;
        fields.add(`facts.${index}`);
      } else {
        listing['facts'] = Object.fromEntries(FACT_GROUPS.map((group) => [group, null]));
        fields.add('facts');
      }
    } else if (key === 'media' && typeof index === 'number' && leaf === 'caption') {
      const media = (listing['media'] as Mutable[] | undefined)?.[index];
      if (media === undefined) {
        repairable = false;
        break;
      }
      media['caption'] = null;
      fields.add('media.caption');
    } else {
      repairable = false;
      break;
    }
  }

  if (!repairable) {
    throw first.error;
  }
  const id = typeof listing?.['id'] === 'string' ? listing['id'] : 'unknown';
  console.warn(
    `Listing detail ${id}: nulled invalid feed values in ${[...fields].sort().join(', ')}.`,
  );
  return listingDetailSchema.parse(repaired);
}
