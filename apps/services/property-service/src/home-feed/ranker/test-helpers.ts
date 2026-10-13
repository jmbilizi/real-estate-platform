import { cardFixture } from '../../listings/test-fixtures';
import type { Candidate } from './features';

type CardOverrides = Record<string, unknown>;

let counter = 0;

/** A unique-id candidate. `overrides` change the card and the per-row facts. */
export function candidate(
  card: CardOverrides = {},
  extra: Partial<Omit<Candidate, 'card'>> = {},
): Candidate {
  counter += 1;
  const n = String(counter).padStart(12, '0');
  return {
    card: cardFixture({
      id: `018f2f2a-6d1b-7c3d-8b2e-${n}`,
      propertyId: `018f2f2a-6d1b-7c3d-8b2f-${n}`,
      officeName: `Office ${counter}`,
      ...card,
    } as never),
    distanceKm: 3,
    photoCount: 10,
    hasPreferredPhoto: false,
    popularity: 0,
    ...extra,
  };
}
