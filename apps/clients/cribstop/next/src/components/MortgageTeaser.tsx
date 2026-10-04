'use client';

import { useId, useState } from 'react';
import {
  downPaymentAmount,
  monthlyHoa,
  monthlyPrincipalAndInterest,
  monthlyTax,
  parseNumberInput,
  TERM_YEARS,
  type TermYears,
} from '@/lib/mortgage';

interface Props {
  price: number;
  taxAnnualAmount?: number | null;
  hoaFee?: number | null;
  hoaFeeFrequency?: string | null;
}

// Starting values for the inputs. They are examples, not market data, and the card says so.
const EXAMPLE_DOWN_PERCENT = '20';
const EXAMPLE_RATE = '6.5';

const usd = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(value));

// `text-base` keeps the font at 16px so iOS does not zoom on focus. `min-h-11` is the 44px target.
const inputClass =
  'min-h-11 w-full rounded-lg border border-surface-border bg-white px-3 text-base text-ink ' +
  'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30';

export default function MortgageTeaser({
  price,
  taxAnnualAmount = null,
  hoaFee = null,
  hoaFeeFrequency = null,
}: Props) {
  const id = useId();
  const [downMode, setDownMode] = useState<'percent' | 'amount'>('percent');
  const [downRaw, setDownRaw] = useState(EXAMPLE_DOWN_PERCENT);
  const [rateRaw, setRateRaw] = useState(EXAMPLE_RATE);
  const [term, setTerm] = useState<TermYears>(30);

  const down = downPaymentAmount(price, downMode, parseNumberInput(downRaw));
  const rate = parseNumberInput(rateRaw);
  const loan = down === null ? null : price - down;
  const pAndI =
    loan === null || rate === null ? null : monthlyPrincipalAndInterest(loan, rate, term);
  const tax = monthlyTax(taxAnnualAmount);
  const hoa = monthlyHoa(hoaFee, hoaFeeFrequency);
  const total = pAndI === null ? null : pAndI + (tax ?? 0) + (hoa ?? 0);

  const downInvalid = down === null;
  const rateInvalid = rate === null || rate > 30;

  function switchMode(next: 'percent' | 'amount') {
    if (next === downMode) return;
    // Carry a valid figure across so the toggle converts instead of reinterpreting the digits.
    if (down !== null) {
      setDownRaw(
        String(next === 'percent' ? Number(((down / price) * 100).toFixed(2)) : Math.round(down)),
      );
    }
    setDownMode(next);
  }

  // A price of 0 has no estimate to give.
  if (!(price > 0)) return null;

  const segment = (active: boolean) =>
    `min-h-11 flex-1 rounded-lg border px-3 text-sm font-medium ${
      active
        ? 'border-brand-600 bg-white text-brand-700'
        : 'border-surface-border bg-transparent text-ink-muted'
    }`;

  return (
    <div className="rounded-2xl border border-surface-border bg-brand-50/50 p-6">
      {/* `title-md` (16px/600) per DESIGN.md. */}
      <h3 className="text-base font-semibold text-ink">Estimated monthly payment</h3>

      {total !== null && pAndI !== null ? (
        <p
          className="mt-2 text-xl font-semibold tracking-[-0.18px] text-brand-700"
          aria-live="polite"
          data-testid="mortgage-total"
        >
          {usd(total)}
          <span className="text-sm font-normal text-ink-muted"> / month</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-muted" aria-live="polite" data-testid="mortgage-hint">
          {loan !== null && loan <= 0
            ? 'The down payment covers the full price, so there is no loan payment.'
            : 'Enter a down payment below the price and an interest rate to see an estimate.'}
        </p>
      )}

      <div className="mt-4 space-y-4">
        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`${id}-down`} className="text-sm font-medium text-ink">
              Down payment
            </label>
            <div className="flex w-28 gap-1" role="group" aria-label="Down payment unit">
              <button
                type="button"
                aria-pressed={downMode === 'percent'}
                className={segment(downMode === 'percent')}
                onClick={() => switchMode('percent')}
              >
                %
              </button>
              <button
                type="button"
                aria-pressed={downMode === 'amount'}
                className={segment(downMode === 'amount')}
                onClick={() => switchMode('amount')}
              >
                $
              </button>
            </div>
          </div>
          <input
            id={`${id}-down`}
            className={`${inputClass} mt-1`}
            inputMode="decimal"
            autoComplete="off"
            value={downRaw}
            onChange={(e) => setDownRaw(e.target.value)}
            aria-invalid={downInvalid}
            aria-describedby={downInvalid ? `${id}-down-err` : undefined}
          />
          {downInvalid ? (
            <p id={`${id}-down-err`} className="mt-1 text-xs text-ink-muted">
              {downMode === 'percent'
                ? 'Enter a percent from 0 to 100.'
                : `Enter an amount up to ${usd(price)}.`}
            </p>
          ) : downMode === 'percent' ? (
            <p className="mt-1 text-xs text-ink-muted">{usd(down)}</p>
          ) : (
            <p className="mt-1 text-xs text-ink-muted">
              {Number(((down / price) * 100).toFixed(1))}% of the price
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${id}-rate`} className="text-sm font-medium text-ink">
            Interest rate (%)
          </label>
          <input
            id={`${id}-rate`}
            className={`${inputClass} mt-1`}
            inputMode="decimal"
            autoComplete="off"
            value={rateRaw}
            onChange={(e) => setRateRaw(e.target.value)}
            aria-invalid={rateInvalid}
            aria-describedby={`${id}-rate-note`}
          />
          <p id={`${id}-rate-note`} className="mt-1 text-xs text-ink-muted">
            {rateInvalid
              ? 'Enter a rate from 0 to 30.'
              : `${EXAMPLE_RATE}% is an example, not a current rate. Enter your own.`}
          </p>
        </div>

        <div>
          <span id={`${id}-term`} className="text-sm font-medium text-ink">
            Loan term
          </span>
          <div className="mt-1 flex gap-2" role="group" aria-labelledby={`${id}-term`}>
            {TERM_YEARS.map((years) => (
              <button
                key={years}
                type="button"
                aria-pressed={term === years}
                className={segment(term === years)}
                onClick={() => setTerm(years)}
              >
                {years}-yr
              </button>
            ))}
          </div>
        </div>
      </div>

      {pAndI !== null && (
        <dl className="mt-4 space-y-1 border-t border-surface-border pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Principal &amp; interest</dt>
            <dd className="text-ink">{usd(pAndI)}</dd>
          </div>
          {tax !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Property tax</dt>
              <dd className="text-ink">{usd(tax)}</dd>
            </div>
          )}
          {hoa !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">HOA fee</dt>
              <dd className="text-ink">{usd(hoa)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3 font-semibold">
            <dt className="text-ink">Estimated total</dt>
            <dd className="text-ink">{usd(total ?? pAndI)}</dd>
          </div>
        </dl>
      )}

      <p className="mt-3 text-xs text-ink-subtle">
        This is an estimate only. It does not include insurance, mortgage insurance, or other costs,
        and it is not a loan offer.
      </p>
    </div>
  );
}
