/** Pure math for the monthly cost estimate (#570). No React, no formatting. */

export const TERM_YEARS = [15, 20, 30] as const;
export type TermYears = (typeof TERM_YEARS)[number];

/**
 * Parse a user-typed number. Returns null for blank, non-numeric, or non-finite input, so a caller
 * never renders NaN. Accepts "$", "%" and thousands commas.
 */
export function parseNumberInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,%\s]/g, '');
  if (cleaned === '') return null;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Monthly principal and interest. Null when an input is invalid or the loan is zero. */
export function monthlyPrincipalAndInterest(
  loan: number,
  annualRatePercent: number,
  termYears: number,
): number | null {
  if (!Number.isFinite(loan) || loan <= 0) return null;
  if (!Number.isFinite(annualRatePercent) || annualRatePercent < 0 || annualRatePercent > 30) {
    return null;
  }
  if (!Number.isFinite(termYears) || termYears <= 0) return null;
  const n = termYears * 12;
  const r = annualRatePercent / 100 / 12;
  if (r === 0) return loan / n;
  const growth = Math.pow(1 + r, n);
  return (loan * r * growth) / (growth - 1);
}

/**
 * Monthly HOA from the feed's free-text frequency. Null when the fee or the frequency is missing,
 * unknown, or one-time: a figure that is not a recurring cost must not be added to a monthly total.
 */
export function monthlyHoa(fee: number | null, frequency: string | null): number | null {
  if (fee === null || !Number.isFinite(fee) || fee <= 0 || frequency === null) return null;
  const f = frequency
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  switch (f) {
    case 'monthly':
      return fee;
    case 'weekly':
      return (fee * 52) / 12;
    case 'bi-weekly':
    case 'biweekly':
      return (fee * 26) / 12;
    case 'quarterly':
      return fee / 3;
    case 'semi-annually':
    case 'semiannually':
    case 'semi-annual':
      return fee / 6;
    case 'annually':
    case 'annual':
    case 'yearly':
      return fee / 12;
    default:
      return null;
  }
}

export function monthlyTax(annual: number | null): number | null {
  return annual !== null && Number.isFinite(annual) && annual > 0 ? annual / 12 : null;
}

/** Down payment in dollars from a percent or an amount. Null when invalid or above the price. */
export function downPaymentAmount(
  price: number,
  mode: 'percent' | 'amount',
  value: number | null,
): number | null {
  if (value === null || value < 0) return null;
  const amount = mode === 'percent' ? (price * value) / 100 : value;
  if (mode === 'percent' && value > 100) return null;
  return amount <= price ? amount : null;
}
