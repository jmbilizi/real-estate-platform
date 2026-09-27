import type { PropertyPage, PropertyRecord } from '@cribstop/property-contracts';
import ListingDetailContent from '@/components/ListingDetailContent';
import { SampleBadge } from '@/components/listing/ListingBadges';
import { toListingDetailView } from '@/lib/api/listings';
import { formatNumber } from '@/lib/format';

/**
 * The property page (#349): one page per address, in its current market status.
 *
 * `detail` decides what renders, never `marketStatus` on its own. The service has already turned
 * every display rule into `detail`/`propertyRecord`; re-deriving a rule from the status string
 * here would be a second, separately-maintained copy of that rule.
 *
 * One status badge per page, with `marketStatus` verbatim. The detail branch passes it to
 * `ListingDetailContent`, whose own `ConsumerStatus` has no `Under Contract` value.
 */
export default function PropertyPageView({ page }: { page: PropertyPage }) {
  const { propertyRecord, detail, marketStatus } = page;

  return (
    <div className="mx-auto max-w-5xl">
      {detail !== null ? (
        <ListingDetailContent listing={toListingDetailView(detail)} statusLabel={marketStatus} />
      ) : (
        <OffMarketPropertyView propertyRecord={propertyRecord} marketStatus={marketStatus} />
      )}
    </div>
  );
}

/**
 * Off market (#349): the property record alone.
 *
 * NAR 7.58: a withdrawn, expired, canceled or held listing is not displayed. No photo, price,
 * remarks or agent data may appear on this branch, by construction — those fields simply are not
 * read here.
 */
function OffMarketPropertyView({
  propertyRecord,
  marketStatus,
}: {
  propertyRecord: PropertyRecord;
  marketStatus: string;
}) {
  // `address` already carries the unit designator.
  const streetLine = propertyRecord.address;

  // Each fact is omitted, never rendered as a dash or a zero, when the record sends null.
  const facts: Array<{ label: string; value: string | number }> = [
    ...(propertyRecord.beds !== null ? [{ label: 'Beds', value: propertyRecord.beds }] : []),
    ...(propertyRecord.baths !== null ? [{ label: 'Baths', value: propertyRecord.baths }] : []),
    ...(propertyRecord.sqft !== null
      ? [{ label: 'Sqft', value: formatNumber(propertyRecord.sqft) }]
      : []),
    { label: 'Type', value: propertyRecord.propertyType },
    ...(propertyRecord.yearBuilt !== null
      ? [{ label: 'Year Built', value: propertyRecord.yearBuilt }]
      : []),
    ...(propertyRecord.lotSqft !== null
      ? [{ label: 'Lot Size', value: `${formatNumber(propertyRecord.lotSqft)} sf` }]
      : []),
  ];

  return (
    <div className="px-6 py-8 sm:px-8">
      <span className="badge bg-surface-border text-ink" data-testid="market-status-badge">
        {marketStatus}
      </span>
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {streetLine ?? 'Address withheld'}
      </h1>
      <p className="mt-1 text-ink-muted">
        {propertyRecord.city}, {propertyRecord.state} {propertyRecord.zip}
      </p>

      {propertyRecord.isSample && <SampleBadge className="mt-3" />}

      {facts.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-surface-border p-6 sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                {fact.label}
              </p>
              <p className="mt-1 text-base font-semibold text-ink">{fact.value}</p>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-sm text-ink-muted">
        This home is not listed for sale or rent right now.
      </p>
    </div>
  );
}
