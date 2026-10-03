/**
 * Guard for #535: a map file never renders listing price, attribution or photo markup itself.
 * `ListingCard` owns them, so a change to its compliance rules applies on the map too.
 * Source scan: Leaflet does not run under jsdom.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const dir = __dirname;
const mapFiles = readdirSync(dir).filter(
  (f) => /^(.*Map.*|map-.*|PricePinLayer)\.tsx?$/.test(f) && !/\.spec\.tsx?$/.test(f),
);

const FORBIDDEN: Array<[string, RegExp]> = [
  ['a listing photo component', /components\/listing\/ListingImage/],
  ['an attribution component', /components\/listing\/ListingAttribution/],
  ['a disclosure badge component', /components\/listing\/ListingBadges/],
  ['an <img> or next/image element', /<img\b|<Image\b|next\/image/],
  ['listing photo data', /\bprimaryMedia\b/],
  ['attribution data', /\b(officeName|listingAgentName|listedBy|brokerPhone|brokerEmail)\b/],
  [
    'a card text formatter',
    /\b(formatClosePrice|formatStreetAddress|formatCardAddress|formatDwellingStats|formatLotSize|formatListingLocation)\b/,
  ],
];

// A pin label is not a card. The detail page's single-pin map and the search map's price pills
// (#546) print the price, and the pill uses the card's formatter so the two always agree.
const PRICE_FORMATTER_ALLOWED = new Set(['SingleListingMapInner.tsx', 'PricePinLayer.tsx']);

describe('map files render listings only through ListingCard', () => {
  it('finds the map files', () => {
    expect(mapFiles).toEqual(expect.arrayContaining(['ListingsMapInner.tsx']));
  });

  it.each(mapFiles)('%s has no price, attribution or photo markup of its own', (file) => {
    const source = readFileSync(join(dir, file), 'utf8');
    for (const [what, pattern] of FORBIDDEN) {
      expect({ file, what, found: pattern.test(source) }).toEqual({ file, what, found: false });
    }
    if (!PRICE_FORMATTER_ALLOWED.has(file)) {
      expect({
        file,
        what: 'formatListingPrice',
        found: /\bformatListingPrice\b/.test(source),
      }).toEqual({
        file,
        what: 'formatListingPrice',
        found: false,
      });
    }
  });

  it('PricePinLayer renders the shared ListingCard in its popup', () => {
    const source = readFileSync(join(dir, 'PricePinLayer.tsx'), 'utf8');
    expect(source).toMatch(/import ListingCard from '@\/components\/ListingCard'/);
    expect(source).toMatch(/<ListingCard\b/);
  });
});
