import type { PriceHistoryEntry } from '@cribstop/property-contracts';
import { formatCalendarDate, formatPrice } from '@/lib/format';

/**
 * #717. The MLS list prices we hold for this home: date, price, change from the row above, and the
 * MLS number of the record that carried the price. A price the seller withheld never reaches this
 * list. The service sends an empty list then, and this renders nothing.
 */
export default function PriceHistory({
  entries,
  className = '',
}: {
  entries: readonly PriceHistoryEntry[];
  className?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <section id="price-history" className={`${className} p-6`} data-testid="price-history">
      <h2 className="text-xl font-semibold tracking-tight">Price history</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[20rem] text-left text-sm">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              <th scope="col" className="py-2 pr-4 font-semibold">
                Date
              </th>
              <th scope="col" className="py-2 pr-4 font-semibold">
                Price
              </th>
              <th scope="col" className="py-2 pr-4 font-semibold">
                Change
              </th>
              <th scope="col" className="py-2 font-semibold">
                MLS number
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={`${entry.date}-${index}`} className="border-t border-surface-border">
                <td className="py-2 pr-4 whitespace-nowrap text-ink-body">
                  {formatCalendarDate(entry.date)}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap font-semibold text-ink">
                  {formatPrice(entry.price, 'sale')}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap text-ink-body">
                  <ChangeCell change={entry.change} />
                </td>
                <td className="py-2 whitespace-nowrap text-ink-body">{entry.mlsNumber ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-muted">Price history from MLS records we hold.</p>
    </section>
  );
}

/** A cut and an increase share one style. The arrow and the amount carry the meaning. */
function ChangeCell({ change }: { change: number | null }) {
  if (change === null || change === 0) return <span aria-label="No change">—</span>;
  const amount = formatPrice(Math.abs(change), 'sale');
  return (
    <>
      <span aria-hidden="true">
        {change < 0 ? '↓' : '↑'} {amount}
      </span>
      <span className="sr-only">
        {change < 0 ? 'Reduced by' : 'Increased by'} {amount}
      </span>
    </>
  );
}
