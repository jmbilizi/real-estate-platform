import { render, screen } from '@testing-library/react';
import { BRAND } from '@/lib/brand';
import AboutPage from './page';

/**
 * This page is prose about the business, not a disclosure attached to a dataset — it has no
 * `getListingsMeta` call and therefore no truth test available to it. So the guard here is the
 * inverse of `Footer.spec.tsx`: the footer proves its Bright block renders *only* when the dataset
 * says so, and this proves the about page makes no such claim *at all*.
 *
 * Both halves are asserted as pattern tables scanned over the whole rendered document rather than
 * as `queryByText` calls against the exact sentences that used to be here. That distinction is the
 * point of the test: matching the old wording would only catch a copy-paste revert, and the failure
 * being guarded against is someone re-adding a *differently phrased* provenance claim or freshness
 * date by hand, when the approved wording is #33's to deliver with broker sign-off.
 */

/** Anything asserting where listing data came from. Approved replacement copy arrives via #33. */
const PROVENANCE_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Bright (MLS brand)', /bright/i],
  ['MLS', /\bMLS\b/i],
  ['multiple listing service', /multiple\s+listing\s+service/i],
  ['IDX', /\bIDX\b/i],
  ['Internet Data Exchange', /internet\s+data\s+exchange/i],
  ['"provided by ..."', /provided\s+by/i],
  ['"courtesy of ..."', /courtesy\s+of/i],
  ['"listing broker"', /listing\s+broker/i],
  ['"licensing agreement"', /licensing\s+agreement/i],
  ['"syndicated/supplied/sourced from"', /(syndicated|supplied|sourced)\s+(by|from)/i],
];

/**
 * Any literal calendar value. A freshness date cannot be stated correctly in static JSX — it is
 * wrong on every day but one (PRD §6.3) — and the footer already states it once per route from
 * `GET /property/listings/meta`, omitting the line when there is no timestamp.
 */
const HARDCODED_DATE_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    // Matches a month followed by either a day ("April 21") or a year ("April 2026"). Deliberately
    // NOT a bare four-digit year: scanned over the whole document, that also hits a street address
    // ("1900 K Street NW") or a support phone number, failing the suite with a compliance message
    // about a line nobody touched.
    'month-name date',
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}|\d{4})\b/i,
  ],
  ['numeric date (1/2/2026)', /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/],
  ['ISO date (2026-04-21)', /\b\d{4}-\d{2}-\d{2}\b/],
  ['"data last updated"', /data\s+last\s+updated/i],
];

describe('AboutPage', () => {
  /**
   * Everything on the page a person or a screen reader can perceive — visible text *plus* the
   * attributes that carry copy.
   *
   * Attributes are not padding here, they are the likeliest reintroduction vector. IDX display
   * rules generally want the source's logo, so the natural way this claim comes back is
   * `<img src="/bright-mls.svg" alt="Listing data provided by Bright MLS" />` or a link with a
   * `title`. Those are MLS-provenance claims to every user, but they contribute nothing to
   * `textContent`, so a text-only scan would wave them straight through.
   *
   * `innerHTML` would catch them too, and is wrong: it also sweeps up `class`, where Tailwind's
   * `brightness-*` utilities would trip the `/bright/i` pattern on a page with no claim on it.
   * Enumerating the copy-bearing attributes keeps the scan on things a user actually perceives.
   */
  function renderedText(): string {
    const { baseElement } = render(<AboutPage />);
    const copyAttributes = ['alt', 'title', 'aria-label', 'aria-description', 'href', 'src'];

    const fromAttributes = Array.from(baseElement.querySelectorAll('*'))
      .flatMap((el) => copyAttributes.map((name) => el.getAttribute(name)))
      .filter((value): value is string => value !== null);

    return [baseElement.textContent ?? '', ...fromAttributes].join('\n');
  }

  describe('makes no MLS-provenance claim (stakeholder ruling on #75)', () => {
    it.each(PROVENANCE_PATTERNS)('does not mention %s', (_label, pattern) => {
      expect(renderedText()).not.toMatch(pattern);
    });
  });

  describe('states no hardcoded data-freshness value', () => {
    it.each(HARDCODED_DATE_PATTERNS)('does not render %s', (_label, pattern) => {
      expect(renderedText()).not.toMatch(pattern);
    });
  });

  it('keeps Real Broker, LLC prominent, sourced from lib/brand (PRD §6.1)', () => {
    render(<AboutPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(BRAND.brokerageShort);
    expect(screen.getByText(new RegExp(`Brokered by ${BRAND.brokerageShort}`))).toBeInTheDocument();
    expect(screen.getByText(/Equal Housing Opportunity/)).toBeInTheDocument();
  });

  it('keeps the source-neutral disclaimer and the Fair Housing statement, which are true and stay', () => {
    render(<AboutPage />);

    expect(screen.getByText(/Fair Housing & Compliance/)).toBeInTheDocument();
    expect(
      screen.getByText(/committed to the principles of the Fair Housing Act/),
    ).toBeInTheDocument();
    expect(screen.getByText(/may no longer be available/)).toBeInTheDocument();
  });
});
