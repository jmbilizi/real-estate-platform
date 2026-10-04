import type { ListingDetailView } from '@/lib/api/listings';
import { formatNumber } from '@/lib/format';

export interface FactRow {
  label: string;
  value: string;
}

export interface FactGroup {
  id: string;
  title: string;
  rows: FactRow[];
}

type FactSource = Pick<
  ListingDetailView,
  'facts' | 'taxAnnualAmount' | 'taxYear' | 'hoaFee' | 'hoaFeeFrequency'
>;

/** A list fact as one line. Blank entries and an empty list give null, so the row is omitted. */
function listValue(values: string[] | null): string | null {
  const kept = (values ?? []).map((v) => v.trim()).filter(Boolean);
  return kept.length > 0 ? kept.join(', ') : null;
}

/** A money fact. Zero is "not stated" for tax and HOA, never "$0". */
function moneyValue(amount: number | null): string | null {
  return amount !== null && amount > 0 ? `$${formatNumber(Math.round(amount))}` : null;
}

function taxValue(listing: FactSource): string | null {
  const amount = moneyValue(listing.taxAnnualAmount);
  if (amount === null) return null;
  return listing.taxYear ? `${amount} (${listing.taxYear})` : amount;
}

function hoaValue(listing: FactSource): string | null {
  const amount = moneyValue(listing.hoaFee);
  if (amount === null) return null;
  const frequency = listing.hoaFeeFrequency?.trim().toLowerCase();
  return frequency ? `${amount} ${frequency}` : amount;
}

/**
 * The grouped facts for the detail page (#568). A row without data and a group without rows are
 * dropped, so the caller renders nothing for an empty result.
 */
export function buildFactGroups(listing: FactSource): FactGroup[] {
  const { facts } = listing;
  const defs: Array<{ id: string; title: string; rows: Array<[string, string | null]> }> = [
    {
      id: 'interior',
      title: 'Interior',
      rows: [
        ['Interior features', listValue(facts.interior)],
        ['Appliances', listValue(facts.appliances)],
        ['Flooring', listValue(facts.flooring)],
        ['Basement', listValue(facts.basement)],
      ],
    },
    {
      id: 'heating-cooling',
      title: 'Heating & cooling',
      rows: [
        ['Heating', listValue(facts.heating)],
        ['Cooling', listValue(facts.cooling)],
      ],
    },
    { id: 'parking', title: 'Parking', rows: [['Parking', listValue(facts.parking)]] },
    { id: 'exterior', title: 'Exterior', rows: [['Exterior features', listValue(facts.exterior)]] },
    {
      id: 'tax-hoa',
      title: 'Taxes & HOA',
      rows: [
        ['Annual taxes', taxValue(listing)],
        ['HOA fee', hoaValue(listing)],
      ],
    },
  ];

  return defs
    .map(({ id, title, rows }) => ({
      id,
      title,
      rows: rows.flatMap(([label, value]) => (value === null ? [] : [{ label, value }])),
    }))
    .filter((group) => group.rows.length > 0);
}
