import { render, screen, waitFor, within } from '@testing-library/react';
import { aListingDetail } from '@/test/fixtures';
import { searchListings, toListingDetailView } from '@/lib/api/listings';
import ListingDetailContent from './ListingDetailContent';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: jest.fn(), isSaved: () => false }),
}));

jest.mock('@/lib/api/listings', () => {
  const actual = jest.requireActual('@/lib/api/listings');
  return {
    ...actual,
    searchListings: jest.fn(),
  };
});

// The map is exercised on its own in SingleListingMap.spec.tsx (including the "no pin for a
// suppressed address" guarantee). Stubbing it here keeps these tests focused on content and
// avoids mounting react-leaflet/next-dynamic in every case.
jest.mock('@/components/SingleListingMap', () => ({
  __esModule: true,
  default: (props: { latitude: number | null; longitude: number | null }) => (
    <div
      data-testid="single-listing-map"
      data-lat={props.latitude ?? ''}
      data-lng={props.longitude ?? ''}
    />
  ),
}));

const mockedSearchListings = searchListings as jest.Mock;

beforeEach(() => {
  mockedSearchListings.mockReset();
  mockedSearchListings.mockResolvedValue({
    results: [],
    total: 0,
    page: 1,
    pageSize: 8,
    pageCount: 0,
    appliedFilters: {},
  });
});

/** Renders and waits for the "Similar Homes" fetch to settle, so no test leaves a dangling
 *  unresolved promise that would warn about a state update outside `act`. */
async function renderAndSettle(...args: Parameters<typeof render>) {
  const result = render(...args);
  await waitFor(() => expect(mockedSearchListings).toHaveBeenCalled());
  return result;
}

describe('ListingDetailContent — provenance (#24 acceptance criterion)', () => {
  it('renders no Bright provenance string for an internal listing', async () => {
    const view = toListingDetailView(aListingDetail({ listing: { source: 'internal' } }));
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.queryByText(/Bright/i)).toBeNull();
  });

  it('renders the Bright provenance line for a brightMLS listing', async () => {
    const view = toListingDetailView(aListingDetail({ listing: { source: 'brightMLS' } }));
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getByText(/Bright MLS/i)).toBeInTheDocument();
  });

  it('renders neither provenance line for an "other" source listing', async () => {
    const view = toListingDetailView(aListingDetail({ listing: { source: 'other' } }));
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.queryByText(/Bright/i)).toBeNull();
    expect(screen.queryByText(/provided by/i)).toBeNull();
  });
});

describe('ListingDetailContent — price', () => {
  it('renders the withheld copy and never $0 when price is null', async () => {
    const view = toListingDetailView(aListingDetail({ listing: { price: null } }));
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getAllByText(/Price withheld/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('shows the close price with its close date for a sold listing', async () => {
    const view = toListingDetailView(
      aListingDetail({
        listing: {
          status: 'Sold',
          closePrice: 610000,
          closeDate: '2026-03-15',
        },
      }),
    );
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getAllByText(/Sold for \$610,000 on Mar 15, 2026/).length).toBeGreaterThan(0);
  });
});

describe('ListingDetailContent — parcel', () => {
  it('renders no dwelling stat block and does not throw', async () => {
    const view = toListingDetailView(
      aListingDetail({
        property: { propertyType: 'Land' },
        listing: { propertyType: 'Land', beds: null, baths: null, sqft: null, lotSqft: 104544 },
      }),
    );

    await expect(renderAndSettle(<ListingDetailContent listing={view} />)).resolves.not.toThrow();

    expect(screen.queryByText('Beds')).toBeNull();
    expect(screen.queryByText('Baths')).toBeNull();
    expect(screen.queryByText('Sqft')).toBeNull();
  });
});

describe('ListingDetailContent — suppressed address', () => {
  it('renders no address and passes no coordinates to the map', async () => {
    const view = toListingDetailView(
      aListingDetail({
        listing: { address: null, latitude: null, longitude: null },
      }),
    );
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.queryByText('100 Test St')).toBeNull();
    const map = screen.getByTestId('single-listing-map');
    expect(map.getAttribute('data-lat')).toBe('');
    expect(map.getAttribute('data-lng')).toBe('');
  });

  it('does not fall back to the listing title, which is not covered by address suppression', async () => {
    // Server-side suppression masks address/latitude/longitude/unitNumber but NOT the free-text
    // `title` (#59). A real feed's title routinely carries the street line, so heading-falls-back-
    // to-title would hand back precisely the address the seller withheld.
    const view = toListingDetailView(
      aListingDetail({
        listing: {
          address: null,
          latitude: null,
          longitude: null,
          title: '742 Evergreen Terrace — Rare Find (Sample)',
          neighborhood: 'Downtown',
          city: 'Bethesda',
          state: 'MD',
        },
      }),
    );
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.queryByText(/742 Evergreen Terrace/)).toBeNull();
    expect(screen.queryByText(/Evergreen/)).toBeNull();

    // The heading falls back to location, which has no street component by construction.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Downtown, Bethesda');
  });

  it('still renders the street address when the seller did not opt out', async () => {
    const view = toListingDetailView(aListingDetail());
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '100 Test St, Bethesda, MD 20814',
    );
  });
});

describe('ListingDetailContent — sample labelling', () => {
  it('renders the sample label for a sample row', async () => {
    const view = toListingDetailView(aListingDetail({ listing: { isSample: true } }));
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getByText(/sample data/i)).toBeInTheDocument();
  });
});

describe('ListingDetailContent — NAR 7.58 attribution', () => {
  /**
   * The disclosure panel always asks `ListingAttribution` for the reduced `courtesy` density — the
   * Listing Agent card in the sidebar already carries the name, office, phone and email, so the
   * courtesy line exists to avoid repeating all of it. But `showFullBlock` in `ListingAttribution`
   * is computed off the row's own `source` before the `courtesy` density is honoured, so a
   * `brightMLS` row still gets the full block regardless of the density this surface asks for. Before
   * that ordering was fixed, this was the one path in the app where an IDX row could render with no
   * contact method at all. Scoped to the disclosure panel because the sidebar's Listing Agent card
   * independently renders the same agent name, phone and email as plain text.
   */
  it('renders the full block for a brightMLS row even though the detail page requests courtesy density', async () => {
    const view = toListingDetailView(
      aListingDetail({
        listing: {
          source: 'brightMLS',
          listedBy: 'Jane Q. Agent – Bright Partner Realty',
          listingAgentName: 'Jane Q. Agent',
          officeName: 'Bright Partner Realty',
          brokerPhone: '(301) 555-0199',
          brokerEmail: 'jane.agent@example.com',
        },
      }),
    );
    const { container } = await renderAndSettle(<ListingDetailContent listing={view} />);

    const disclosure = container.querySelector(
      '.text-\\[13px\\].leading-relaxed.text-ink-muted',
    ) as HTMLElement;

    expect(
      within(disclosure).getByText('Jane Q. Agent – Bright Partner Realty'),
    ).toBeInTheDocument();
    expect(within(disclosure).getByText('Jane Q. Agent')).toBeInTheDocument();
    expect(within(disclosure).getByRole('link', { name: '(301) 555-0199' })).toBeInTheDocument();
    expect(
      within(disclosure).getByRole('link', { name: 'jane.agent@example.com' }),
    ).toBeInTheDocument();
    expect(within(disclosure).getByText(/Bright Partner Realty/)).toBeInTheDocument();
  });

  it('carries the median type-size floor on the attribution line explicitly, rather than inheriting the disclosure panel’s smaller size', async () => {
    // The disclosure panel itself is `text-[13px]`. Attribution must not fall below the median type
    // size used for the listing data — `text-sm` (14px) on the rebuilt detail page — so the line has
    // to set it explicitly rather than inherit the panel's 13px, a floor missed by a pixel that a
    // future layout change could silently reintroduce.
    const view = toListingDetailView(aListingDetail({ listing: { source: 'internal' } }));
    await renderAndSettle(<ListingDetailContent listing={view} />);

    const attribution = screen.getByText(/Listing courtesy of/i);
    expect(attribution.className).toContain('text-sm');
    expect(attribution.className).not.toMatch(/text-\[1[0-3]px\]|text-xs/);
  });
});
