import {
  isNoiseNeighborhood,
  neighborhoodNotNoiseSql,
  neighborhoodSlugSql,
  normalizeNeighborhood,
} from './neighborhood-normalize';

describe('isNoiseNeighborhood', () => {
  it.each([
    'NONE',
    'NONE AVAILABLE',
    'NONE AVAILABLE.',
    'None Availalbe', // misspelling
    'NONE AVAIL',
    'NONE RURAL',
    'N/A',
    'NA',
    'UNKNOWN',
    'NOT ON LIST',
    'NOT IN A DEVELOPMENT',
    'NOT IN DEVELOPMENT',
    'NOT IN SUBDIVISION',
    'NOT IN A SUBDIVISION',
    '000',
    '--',
    '.',
    '',
  ])('treats %j as noise', (value) => {
    expect(isNoiseNeighborhood(value)).toBe(true);
  });

  it.each(['Fishtown', 'Del Ray', 'Old Town Alexandria', 'U Street Corridor'])(
    'does not treat %j as noise',
    (value) => {
      expect(isNoiseNeighborhood(value)).toBe(false);
    },
  );
});

describe('normalizeNeighborhood', () => {
  it('passes null through', () => {
    expect(normalizeNeighborhood(null)).toBeNull();
  });

  it('maps every noise value to null', () => {
    expect(normalizeNeighborhood('NONE AVAILABLE')).toBeNull();
    expect(normalizeNeighborhood('000')).toBeNull();
  });

  it('trims and collapses internal whitespace', () => {
    expect(normalizeNeighborhood('  Old   Town  ')).toBe('Old Town');
  });

  it('strips wrapping quotes', () => {
    expect(normalizeNeighborhood('"Fishtown"')).toBe('Fishtown');
    expect(normalizeNeighborhood("'Fishtown'")).toBe('Fishtown');
  });

  it('strips a trailing period run', () => {
    expect(normalizeNeighborhood('Fishtown.')).toBe('Fishtown');
    expect(normalizeNeighborhood('Fishtown...')).toBe('Fishtown');
  });

  it('preserves the raw variant case', () => {
    expect(normalizeNeighborhood('FISHTOWN')).toBe('FISHTOWN');
  });

  it('maps a value that becomes empty after cleanup to null', () => {
    expect(normalizeNeighborhood('  "." ')).toBeNull();
  });
});

/**
 * The SQL predicate is exercised only for shape (no database in this project's unit-test scope,
 * matching every other query-shape test in this service) — real filtering is proven by the
 * repository query tests and by the EXPLAIN evidence in the PR.
 */
describe('neighborhoodNotNoiseSql', () => {
  it('excludes null and every JS-side noise pattern the same way', () => {
    const sql = neighborhoodNotNoiseSql('v.neighborhood');
    expect(sql).toContain('v.neighborhood IS NOT NULL');
    expect(sql).toContain("v.neighborhood !~* '^NONE\\y'");
    expect(sql).toContain("v.neighborhood !~ '^[0-9\\s.,_/-]*$'");
  });
});

/**
 * Documents the exact SQL text this function must keep in sync with `slugify()`
 * (`@cribstop/property-contracts`). It cannot prove the two produce the same string for every
 * input — that needs a real Postgres, per this file's own DB-free scope — so a change to either
 * `slugify()` or this function must update the other by hand; see the doc comment on
 * `neighborhoodSlugSql` for the mirrored steps.
 */
describe('neighborhoodSlugSql', () => {
  it('lower-cases, expands &, collapses non-alphanumeric runs to one hyphen, and trims hyphens', () => {
    const sql = neighborhoodSlugSql('name');
    expect(sql).toBe(
      "trim(both '-' from regexp_replace(lower(replace(name, '&', ' and ')), '[^a-z0-9]+', '-', 'g'))",
    );
  });
});
