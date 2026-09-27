import type {
  ListingCardRow,
  PropertyHistoryEntry,
  PropertyPage,
  PropertyRecord,
} from '@cribstop/property-contracts';
import ListingDetailContent from '@/components/ListingDetailContent';
import ListingRow from '@/components/ListingRow';
import { SampleBadge } from '@/components/listing/ListingBadges';
import { toListingDetailView } from '@/lib/api/listings';
import { formatDate, formatNumber } from '@/lib/format';
import { formatClosePrice, formatListingPrice } from '@/lib/listing-format';

/**
 * The property page (#382): one page per home, in its current market status.
 *
 * `latestListing` decides what renders, never `marketStatus` on its own. The service has already
 * applied every display rule to `latestListing`, `history` and `nearby`. Re-deriving a rule from
 * the status string here would be a second, separately-maintained copy of that rule.
 *
 * One status badge per page, with `marketStatus` verbatim. The listing branch passes it to
 * `ListingDetailContent`, whose own `ConsumerStatus` has no `Under Contract` value.
 */
export default function PropertyPageView({ page }: { page: PropertyPage }) {
  const { propertyRecord, latestListing, marketStatus, history, nearby } = page;
  const historyPanel = history.length > 0 ? <PropertyHistory entries={history} /> : undefined;

  return (
    <div className="mx-auto max-w-5xl">
      {latestListing !== null ? (
        <ListingDetailContent
          listing={toListingDetailView(latestListing)}
          statusLabel={marketStatus}
          nearby={nearby}
          propertyPanel={historyPanel}
        />
      ) : (
        <OffMarketPropertyView
          propertyRecord={propertyRecord}
          marketStatus={marketStatus}
          historyPanel={historyPanel}
          nearby={nearby}
        />
      )}
    </div>
  );
}

/** One line per past listing. The service sends only the listings whose data may display. */
function historyEvent(entry: PropertyHistoryEntry): string {
  if (entry.marketStatus === 'Sold') {
    return formatClosePrice(entry.closePrice, entry.closeDate) ?? 'Sold';
  }
  const listingType = entry.listingType === 'rent' ? 'rent' : 'sale';
  return `${entry.marketStatus} · ${formatListingPrice(entry.price, listingType).text}`;
}

function PropertyHistory({ entries }: { entries: PropertyHistoryEntry[] }) {
  return (
    <section className="px-6 py-6" data-testid="property-history">
      <h2 className="text-xl font-semibold tracking-tight text-ink">Listing history</h2>
      <ul className="mt-4 divide-y divide-surface-border">
        {entries.map((entry) => (
          <li key={entry.listingId} className="flex items-baseline justify-between gap-4 py-3">
            <span className="text-sm text-ink">{historyEvent(entry)}</span>
            <span className="shrink-0 text-sm text-ink-muted">
              Updated {formatDate(entry.lastUpdated)}
            </span>
          </li>
        ))}
      </ul>
    </section>
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
  historyPanel,
  nearby,
}: {
  propertyRecord: PropertyRecord;
  marketStatus: string;
  historyPanel: React.ReactNode;
  nearby: ListingCardRow[];
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

      {historyPanel !== undefined && (
        <div className="mt-6 rounded-2xl border border-surface-border">{historyPanel}</div>
      )}

      {nearby.length > 0 && (
        <div className="mt-6 rounded-2xl border border-surface-border">
          <ListingRow
            title="Nearby homes"
            listings={nearby}
            max={6}
            sectionClassName="px-6 py-6"
            titleClassName="text-xl font-semibold tracking-tight"
          />
        </div>
      )}
    </div>
  );
}
