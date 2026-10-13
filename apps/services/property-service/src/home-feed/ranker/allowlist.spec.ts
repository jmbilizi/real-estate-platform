import { LISTING_CARD_SELECT } from '../../listings/columns';
import { FEED_EXTRA_COLUMNS } from '../candidates';
import { computeFeatures, EMPTY_MODEL } from './features';
import { candidate } from './test-helpers';
import { FEATURE_KEYS, WEIGHTS } from './v1-weights';

/**
 * Fair Housing guard (#835). This list is the whole feature allowlist. A new feature fails these
 * tests until a compliance review adds it here on purpose.
 */
const APPROVED_FEATURES = ['attrs', 'freshness', 'geo', 'photos', 'popularity', 'price'];

const BANNED_WORDS = [
  'demograph',
  'census',
  'school',
  'crime',
  'religion',
  'language',
  'ethnic',
  'race',
  'income',
  'familial',
  'family',
  'disability',
  'national_origin',
  'neighborhood_score',
  'walk_score',
];

describe('feature allowlist', () => {
  it('holds exactly the six approved features', () => {
    expect([...FEATURE_KEYS].sort()).toEqual(APPROVED_FEATURES);
  });

  it('has one weight per feature and the weights sum to 1', () => {
    expect(Object.keys(WEIGHTS).sort()).toEqual(APPROVED_FEATURES);
    const total = Object.values(WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('returns only the approved keys, each in 0 to 1', () => {
    const features = computeFeatures(candidate(), EMPTY_MODEL, 20, Date.now());
    expect(Object.keys(features).sort()).toEqual(APPROVED_FEATURES);
    for (const value of Object.values(features)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('reads no demographic, school or crime column in the candidate query', () => {
    const columns = `${LISTING_CARD_SELECT}, ${FEED_EXTRA_COLUMNS.join(', ')}`.toLowerCase();
    for (const word of BANNED_WORDS) {
      expect(columns).not.toContain(word);
    }
  });
});
