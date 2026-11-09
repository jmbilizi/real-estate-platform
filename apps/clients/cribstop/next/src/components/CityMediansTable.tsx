import { type CityMedianRow, NOT_ENOUGH_DATA } from '@/lib/city-summary';
import { formatDate } from '@/lib/format';

/**
 * The medians table of a city page (#986). A server component, so the table is in the first HTML.
 * Every row carries its date and source. A withheld figure shows text and no number.
 */
export default function CityMediansTable({
  rows,
  asOf,
  source,
  caption,
  timeZone,
}: {
  rows: readonly CityMedianRow[];
  asOf: string;
  source: string;
  caption: string;
  timeZone?: string;
}) {
  return (
    <table className="mt-3 w-full text-left text-xs">
      <caption className="pb-1 text-left text-xs font-semibold text-ink-body">{caption}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-surface-border align-top">
            <th scope="row" className="py-1.5 pr-2 font-normal text-ink-muted">
              {row.label}
            </th>
            <td className="py-1.5 text-right">
              <span className="block text-sm font-semibold text-ink-body">
                {row.value ?? NOT_ENOUGH_DATA}
              </span>
              <span className="block text-ink-muted">
                <time dateTime={asOf}>{formatDate(asOf, timeZone)}</time>
                {` · ${source}`}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
