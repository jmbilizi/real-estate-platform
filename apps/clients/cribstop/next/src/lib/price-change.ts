import { formatPrice } from '@/lib/format';

/**
 * #717. The price change of a listing, from two stored MLS list prices. The service sends both
 * prices. This module turns them into text. It never estimates and never computes a price.
 *
 * Both fields are optional here on purpose: the web app and the service deploy separately, so a
 * response from an older service has neither key. An absent value reads as "no change".
 */
export interface PriceChangeInput {
  price: number | null;
  previousPrice?: number | null;
  /** The day of the change, as midnight UTC. */
  priceChangedAt?: string | null;
  listingType?: string;
}

export interface PriceChange {
  direction: 'down' | 'up';
  /** `$100K`. Never larger than the real change. */
  amountText: string;
  /** `$100,000`, for a screen reader and the detail page. */
  fullAmountText: string;
  /** `4.4%`. From the two stored prices only. */
  percentText: string;
  previousPriceText: string;
  /** `Oct 2`. Always set. The card shows it only inside `CARD_DATE_DAYS`. */
  dateText: string;
  ageDays: number;
}

/** The card names the day of a change this recent. */
export const CARD_DATE_DAYS = 14;
/** No indicator shows for an older change. The price history table keeps it. */
export const MAX_INDICATOR_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 * The compact amount of a change. Rounding never increases the number: `$12,550` reads `$12.5K`
 * and `$1,250,000` reads `$1.2M`. Whole dollars below `$10,000`.
 */
export function formatPriceChangeAmount(amount: number): string {
  const value = Math.floor(Math.abs(amount));
  if (value < 1000) return `$${value}`;
  if (value < 10_000) return `$${value.toLocaleString('en-US')}`;
  if (value < 1_000_000) return `$${tenths(Math.floor(value / 100))}K`;
  return `$${tenths(Math.floor(value / 100_000))}M`;
}

/** `125` tenths is `12.5`. `120` tenths is `12`. Integer math, so no float error. */
function tenths(count: number): string {
  const whole = Math.floor(count / 10);
  const fraction = count % 10;
  return fraction === 0 ? String(whole) : `${whole}.${fraction}`;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * `null` when there is nothing to show: a withheld price, a sold row, no earlier price, no date,
 * the same price twice, or a change older than `MAX_INDICATOR_DAYS`.
 */
export function describePriceChange(
  input: PriceChangeInput,
  now: number = Date.now(),
): PriceChange | null {
  const { price, previousPrice, priceChangedAt } = input;
  if (input.listingType === 'sold') return null;
  if (price == null || price <= 0) return null;
  if (previousPrice == null || previousPrice <= 0 || previousPrice === price) return null;
  if (priceChangedAt == null) return null;
  const changedAt = Date.parse(priceChangedAt);
  if (Number.isNaN(changedAt)) return null;

  const today = new Date(now);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const ageDays = Math.max(0, Math.floor((todayUtc - changedAt) / DAY_MS));
  if (ageDays > MAX_INDICATOR_DAYS) return null;

  const change = price - previousPrice;
  const percent = (Math.abs(change) / previousPrice) * 100;
  return {
    direction: change < 0 ? 'down' : 'up',
    amountText: formatPriceChangeAmount(change),
    fullAmountText: formatPrice(Math.abs(change), 'sale'),
    percentText: `${percent.toFixed(1)}%`,
    previousPriceText: formatPrice(previousPrice, 'sale'),
    dateText: formatDay(priceChangedAt),
    ageDays,
  };
}

/** `↓ $100K` or `↑ $100K`, with the day inside `CARD_DATE_DAYS`. The arrow carries the direction. */
export function formatCardPriceChange(change: PriceChange): string {
  const arrow = change.direction === 'down' ? '↓' : '↑';
  const date = change.ageDays <= CARD_DATE_DAYS ? ` · ${change.dateText}` : '';
  return `${arrow} ${change.amountText}${date}`;
}

/** The screen-reader text of the card indicator, with the full amount: "Price reduced by $100,000". */
export function describeCardPriceChange(change: PriceChange): string {
  const verb = change.direction === 'down' ? 'reduced' : 'increased';
  const date = change.ageDays <= CARD_DATE_DAYS ? `, ${change.dateText}` : '';
  return `Price ${verb} by ${change.fullAmountText}${date}`;
}

/** The detail line: "Reduced $100,000 (4.4%) from $2,297,500 on Oct 2". */
export function formatDetailPriceChange(change: PriceChange): string {
  const verb = change.direction === 'down' ? 'Reduced' : 'Increased';
  return `${verb} ${change.fullAmountText} (${change.percentText}) from ${change.previousPriceText} on ${change.dateText}`;
}
