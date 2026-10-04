/**
 * Pure mapping of the detail-page facts from one `BrightProperties` payload (#564).
 *
 * Every field name below is declared on `BrightProperty` in the committed
 * `docs/bright-mls/bright-metadata.xml`. A field the record does not carry maps to `null`, never
 * to a default.
 *
 * Fields the feed does not declare, so not mapped: `VirtualTourURLBranded`, any 3D or Matterport
 * property, and a listing-agent photo. `BrightMedia` has no confirmed 3D media category, and the
 * agent photo sits in `SysAgentMedia` with no declared key to the listing agent.
 *
 * `VirtualTourURLUnbranded` is the only tour URL mapped. IDX display rules allow an unbranded
 * tour. A branded tour carries the agent's or the brokerage's marketing. Assumption: no written
 * Bright term confirms this yet (#33).
 */

export const FACT_GROUPS = [
  'parking',
  'heating',
  'cooling',
  'appliances',
  'basement',
  'flooring',
  'interior',
  'exterior',
] as const;

export type FactGroup = (typeof FACT_GROUPS)[number];

/** The Bright collection field behind each group. */
export const FACT_SOURCE_FIELDS: Readonly<Record<FactGroup, string>> = Object.freeze({
  parking: 'ParkingFeatures',
  heating: 'Heating',
  cooling: 'Cooling',
  appliances: 'Appliances',
  basement: 'Basement',
  flooring: 'Flooring',
  interior: 'InteriorFeatures',
  exterior: 'ExteriorFeatures',
});

/** Most values kept per group, and the longest value. Both match the `listing_facts` CHECKs. */
const MAX_VALUES_PER_GROUP = 30;
const MAX_VALUE_LENGTH = 80;

export interface MappedListingDetailFacts {
  readonly taxAnnualAmount: number | null;
  readonly taxYear: number | null;
  readonly hoaFee: number | null;
  readonly hoaFeeFrequency: string | null;
  readonly virtualTourUrl: string | null;
  readonly listAgentPhone: string | null;
  readonly listAgentEmail: string | null;
  readonly facts: Readonly<Record<FactGroup, readonly string[]>>;
}

function nonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** An `Edm.Int16` year. A value outside a plausible year is not a tax year. */
function taxYear(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1800 && value <= 2200
    ? value
    : null;
}

/** An absolute `http(s)` URL, or `null`. A tour link that is not a web link is not shown. */
function webUrl(value: unknown): string | null {
  const raw = nonBlank(value);
  if (raw === null) {
    return null;
  }
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Only an array of strings counts. Duplicates, blanks and oversize values drop out. */
function collection(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  for (const item of value) {
    const text = nonBlank(item);
    if (text !== null && text.length <= MAX_VALUE_LENGTH) {
      seen.add(text);
    }
    if (seen.size >= MAX_VALUES_PER_GROUP) {
      break;
    }
  }
  return [...seen];
}

export function mapListingDetailFacts(
  payload: Readonly<Record<string, unknown>>,
): MappedListingDetailFacts {
  const facts = {} as Record<FactGroup, readonly string[]>;
  for (const group of FACT_GROUPS) {
    facts[group] = collection(payload[FACT_SOURCE_FIELDS[group]]);
  }
  return {
    taxAnnualAmount: nonNegative(payload.TaxAnnualAmount),
    taxYear: taxYear(payload.TaxYear),
    hoaFee: nonNegative(payload.AssociationFee),
    hoaFeeFrequency: nonBlank(payload.AssociationFeeFrequency),
    virtualTourUrl: webUrl(payload.VirtualTourURLUnbranded),
    // The agent's own contact, kept apart from the office line in `attribution.ts`.
    listAgentPhone:
      nonBlank(payload.ListAgentPreferredPhone) ?? nonBlank(payload.ListAgentDirectPhone),
    listAgentEmail: nonBlank(payload.ListAgentEmail),
    facts,
  };
}
