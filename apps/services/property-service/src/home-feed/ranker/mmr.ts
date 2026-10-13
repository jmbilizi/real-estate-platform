import type { ListingCardRow } from '@cribstop/property-contracts';
import { EXPLORE_EVERY, MAX_CARDS_PER_OFFICE, MMR_LAMBDA } from './v1-weights';
import type { Candidate } from './features';

export interface Scored {
  readonly candidate: Candidate;
  readonly score: number;
}

export interface Picked {
  readonly item: Scored;
  readonly explore: boolean;
}

/** 1 for the same building, 0.5 for the same ZIP, beds and a price within 10%, else 0. */
export function similarity(a: ListingCardRow, b: ListingCardRow): number {
  if (a.propertyId === b.propertyId) return 1;
  if (a.zip === b.zip && a.beds === b.beds && a.price !== null && b.price !== null) {
    const high = Math.max(a.price, b.price);
    if (high > 0 && Math.abs(a.price - b.price) <= 0.1 * high) return 0.5;
  }
  return 0;
}

/** The office a card belongs to for the cap. A blank office name has no cap. */
export function officeOf(card: ListingCardRow): string | null {
  const name = card.officeName.trim().toLowerCase();
  return name === '' ? null : name;
}

function underOfficeCap(chosen: readonly Picked[], card: ListingCardRow): boolean {
  const office = officeOf(card);
  if (office === null) return true;
  return (
    chosen.filter((p) => officeOf(p.item.candidate.card) === office).length < MAX_CARDS_PER_OFFICE
  );
}

/**
 * Builds one row. Greedy MMR: `next = argmax λ·score − (1 − λ)·max sim(c, chosen)`.
 * One slot in `EXPLORE_EVERY` is a random eligible card, flagged `explore`.
 * A short pool gives a short row, and no exploration slot.
 */
export function selectRow(
  pool: readonly Scored[],
  size: number,
  rng: () => number,
  lambda = MMR_LAMBDA,
): Picked[] {
  const exploreSlots = Math.floor(size / EXPLORE_EVERY);
  const mainTarget = size - exploreSlots;
  const chosen: Picked[] = [];
  const remaining = [...pool];

  while (chosen.length < mainTarget) {
    let bestIndex = -1;
    let bestValue = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const entry = remaining[i] as Scored;
      if (!underOfficeCap(chosen, entry.candidate.card)) continue;
      const redundancy = chosen.reduce(
        (max, p) => Math.max(max, similarity(entry.candidate.card, p.item.candidate.card)),
        0,
      );
      const value = lambda * entry.score - (1 - lambda) * redundancy;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    chosen.push({ item: remaining.splice(bestIndex, 1)[0] as Scored, explore: false });
  }

  if (chosen.length === mainTarget) {
    for (let slot = 0; slot < exploreSlots; slot += 1) {
      const eligible = remaining.filter((entry) => underOfficeCap(chosen, entry.candidate.card));
      if (eligible.length === 0) break;
      const pick = eligible[Math.floor(rng() * eligible.length)] as Scored;
      remaining.splice(remaining.indexOf(pick), 1);
      chosen.splice(Math.floor(rng() * (chosen.length + 1)), 0, { item: pick, explore: true });
    }
  }
  return chosen;
}
