import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { aListingCardRow, aListingDetail } from '@/test/fixtures';
import { searchListings, toListingDetailView } from '@/lib/api/listings';
import ListingDetailContent from './ListingDetailContent';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: jest.fn(), isSaved: () => false }),
}));

const mockToast = jest.fn();
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: mockToast }) }));

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
  mockToast.mockReset();
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

describe('ListingDetailContent — Nearby homes (#566)', () => {
  it('searches active homes of the same offer around the listing and omits the listing itself', async () => {
    const view = toListingDetailView(
      aListingDetail({ listing: { latitude: 38.98, longitude: -77.1, listingType: 'rent' } }),
    );
    mockedSearchListings.mockResolvedValue({
      results: [
        aListingCardRow({ id: view.id }),
        aListingCardRow({ id: '77777777-7777-4777-8777-777777777777' }),
      ],
      total: 2,
      page: 1,
      pageSize: 9,
      pageCount: 1,
      appliedFilters: {},
    });
    await renderAndSettle(<ListingDetailContent listing={view} />);

    const query = mockedSearchListings.mock.calls[0][0];
    expect(query).toMatchObject({ listingType: 'rent', status: ['Active'] });
    expect(JSON.parse(query.boundary).type).toBe('Polygon');
    expect(await screen.findByText('Nearby homes')).toBeInTheDocument();
    expect(screen.queryByText(/similar homes/i)).toBeNull();
  });

  it('renders the server rows without a client search', () => {
    const view = toListingDetailView(aListingDetail());
    render(<ListingDetailContent listing={view} nearby={[aListingCardRow()]} />);

    expect(screen.getByText('Nearby homes')).toBeInTheDocument();
    expect(mockedSearchListings).not.toHaveBeenCalled();
  });
});

describe('ListingDetailContent — sample labelling', () => {
  it('renders the sample label for a sample row', async () => {
    const view = toListingDetailView(aListingDetail({ listing: { isSample: true } }));
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getByText(/sample data/i)).toBeInTheDocument();
  });
});

describe('ListingDetailContent — Listing Agent card contact method (#344)', () => {
  it('renders only the phone when brokerEmail is null (office email missing)', async () => {
    const view = toListingDetailView(
      aListingDetail({
        listing: {
          brokerPhone: '(301) 555-0199',
          brokerEmail: null,
          officeBrokerLeadPhone: null,
          officeBrokerLeadEmail: null,
        },
      }),
    );
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getByText('(301) 555-0199')).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('renders only the email when brokerPhone is blank (office phone missing)', async () => {
    const view = toListingDetailView(
      aListingDetail({ listing: { brokerPhone: '', brokerEmail: 'office@acme.example' } }),
    );
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getByText('office@acme.example')).toBeInTheDocument();
  });

  it('renders both when phone and email are present', async () => {
    const view = toListingDetailView(
      aListingDetail({
        listing: { brokerPhone: '(301) 555-0199', brokerEmail: 'office@acme.example' },
      }),
    );
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getByText('(301) 555-0199')).toBeInTheDocument();
    expect(screen.getByText('office@acme.example')).toBeInTheDocument();
  });
});

describe('ListingDetailContent — NAR 7.58 attribution and the disclaimer footer (#572)', () => {
  const bright = () =>
    toListingDetailView(
      aListingDetail({
        listing: {
          source: 'brightMLS',
          listedBy: 'Jane Q. Agent – Bright Partner Realty',
          listingAgentName: 'Jane Q. Agent',
          officeName: 'Bright Partner Realty',
          listAgentPhone: '(301) 555-0100',
          listAgentEmail: 'jane.agent@example.com',
          brokerPhone: '(301) 555-0199',
          brokerEmail: null,
        },
      }),
    );

  it('names the agent, the office and a contact method once, in the agent card, for a brightMLS row', async () => {
    await renderAndSettle(<ListingDetailContent listing={bright()} />);

    const card = screen.getByText('Listing Agent').parentElement as HTMLElement;
    expect(within(card).getByText('Jane Q. Agent')).toBeInTheDocument();
    expect(within(card).getByText('Bright Partner Realty')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /\(301\) 555-0100/ })).toBeInTheDocument();
    // The old disclosure card repeated these. Each now appears exactly once on the page.
    expect(screen.getAllByText('Jane Q. Agent')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /\(301\) 555-0199/ })).toHaveLength(1);
    expect(screen.queryByText('Jane Q. Agent – Bright Partner Realty')).toBeNull();
    expect(screen.queryByText(/Listing courtesy of/i)).toBeNull();
  });

  it('keeps the office name in the agent card at the 14px median floor', async () => {
    await renderAndSettle(<ListingDetailContent listing={bright()} />);

    const office = screen.getByText('Bright Partner Realty');
    expect(office.className).toContain('text-sm');
    expect(office.className).not.toMatch(/text-\[1[0-3]px\]|text-xs/);
  });

  it('ends the page with the Bright provenance line and the personal-use line, in a small box-less footer', async () => {
    const { container } = await renderAndSettle(<ListingDetailContent listing={bright()} />);

    const footer = container.querySelector('footer') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(footer.className).toContain('text-xs');
    expect(footer.className).not.toMatch(/\b(border|bg-white|rounded-2xl)\b/);
    expect(within(footer).getByText(/Information provided by Bright MLS/)).toBeInTheDocument();
    expect(within(footer).getByText(/Data last updated:/)).toBeInTheDocument();
    expect(within(footer).getByText(/personal, non-commercial use/)).toBeInTheDocument();
    const body = container.querySelector('[data-scroll-body]') as HTMLElement;
    expect(body.lastElementChild).toBe(footer);
  });

  it('shows only the personal-use line for an internal row', async () => {
    const view = toListingDetailView(aListingDetail({ listing: { source: 'internal' } }));
    const { container } = await renderAndSettle(<ListingDetailContent listing={view} />);

    const footer = container.querySelector('footer') as HTMLElement;
    expect(within(footer).getByText(/personal, non-commercial use/)).toBeInTheDocument();
    expect(within(footer).queryByText(/Bright/i)).toBeNull();
  });
});

describe('ListingDetailContent — Share (#135)', () => {
  const LISTING_ID = '11111111-1111-4111-8111-111111111111';
  const CANONICAL =
    'http://localhost/property/100-test-st-bethesda-md/11111111-1111-4111-8111-111111111111';

  /** Replaces one `navigator` member for the duration of a test and restores it after. */
  function stubNavigator(key: string, value: unknown) {
    const original = Object.getOwnPropertyDescriptor(navigator, key);
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
    return () => {
      if (original) Object.defineProperty(navigator, key, original);
      else delete (navigator as unknown as Record<string, unknown>)[key];
    };
  }

  const restores: Array<() => void> = [];
  afterEach(() => {
    while (restores.length > 0) restores.pop()?.();
  });

  async function clickShare(view: ReturnType<typeof toListingDetailView>) {
    await renderAndSettle(<ListingDetailContent listing={view} />);
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
  }

  it('hands the canonical listing URL to the Web Share API when the platform has one', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    restores.push(stubNavigator('share', share));

    await clickShare(toListingDetailView(aListingDetail({ listing: { id: LISTING_ID } })));

    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0]).toMatchObject({ url: CANONICAL });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('copies the canonical URL and confirms it when the platform has no Web Share API', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    restores.push(stubNavigator('share', undefined));
    restores.push(stubNavigator('clipboard', { writeText }));

    await clickShare(toListingDetailView(aListingDetail({ listing: { id: LISTING_ID } })));

    expect(writeText).toHaveBeenCalledWith(CANONICAL);
    expect(mockToast).toHaveBeenCalledWith('Link copied');
  });

  it('falls back to the clipboard when the share sheet fails for a reason other than dismissal', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    restores.push(stubNavigator('share', jest.fn().mockRejectedValue(new Error('not allowed'))));
    restores.push(stubNavigator('clipboard', { writeText }));

    await clickShare(toListingDetailView(aListingDetail({ listing: { id: LISTING_ID } })));

    expect(writeText).toHaveBeenCalledWith(CANONICAL);
  });

  it('does nothing further when the user dismisses the share sheet', async () => {
    const writeText = jest.fn();
    const abort = new DOMException('dismissed', 'AbortError');
    restores.push(stubNavigator('share', jest.fn().mockRejectedValue(abort)));
    restores.push(stubNavigator('clipboard', { writeText }));

    await clickShare(toListingDetailView(aListingDetail({ listing: { id: LISTING_ID } })));

    expect(writeText).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('reads a dismissal a WebView reports as a plain Error, not only a DOMException', async () => {
    const writeText = jest.fn();
    const abort = Object.assign(new Error('dismissed'), { name: 'AbortError' });
    restores.push(stubNavigator('share', jest.fn().mockRejectedValue(abort)));
    restores.push(stubNavigator('clipboard', { writeText }));

    await clickShare(toListingDetailView(aListingDetail({ listing: { id: LISTING_ID } })));

    expect(writeText).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('still copies on a non-secure origin, where navigator.clipboard does not exist', async () => {
    const execCommand = jest.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    restores.push(() => {
      delete (document as unknown as Record<string, unknown>).execCommand;
    });
    restores.push(stubNavigator('share', undefined));
    restores.push(stubNavigator('clipboard', undefined));

    await clickShare(toListingDetailView(aListingDetail({ listing: { id: LISTING_ID } })));

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(mockToast).toHaveBeenCalledWith('Link copied');
  });

  it('reports a failed copy rather than leaving the click silent', async () => {
    Object.defineProperty(document, 'execCommand', {
      value: jest.fn().mockReturnValue(false),
      configurable: true,
    });
    restores.push(() => {
      delete (document as unknown as Record<string, unknown>).execCommand;
    });
    restores.push(stubNavigator('share', undefined));
    restores.push(
      stubNavigator('clipboard', { writeText: jest.fn().mockRejectedValue(new Error('denied')) }),
    );

    await clickShare(toListingDetailView(aListingDetail({ listing: { id: LISTING_ID } })));

    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('could not copy'), 'error');
  });

  it('shares no masked address and no MLS claim for a suppressed sample row', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    restores.push(stubNavigator('share', share));

    await clickShare(
      toListingDetailView(
        aListingDetail({
          listing: {
            id: LISTING_ID,
            address: null,
            latitude: null,
            longitude: null,
            isSample: true,
            title: '742 Evergreen Terrace — Waterfront Penthouse',
          },
        }),
      ),
    );

    const payload = share.mock.calls[0][0] as { title: string; text: string };
    const shared = `${payload.title} ${payload.text}`;

    expect(shared).not.toContain('742 Evergreen Terrace');
    expect(shared).not.toMatch(/MLS|Bright/i);
    expect(shared).toContain('Sample');
    expect(shared).toContain('Real Broker, LLC');
  });

  it('keeps the button’s accessible name', async () => {
    await renderAndSettle(<ListingDetailContent listing={toListingDetailView(aListingDetail())} />);

    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });
});

describe('ListingDetailContent — agent card (#571)', () => {
  it('shows the agent monogram, the bare office name and one-tap links', async () => {
    const view = toListingDetailView(
      aListingDetail({
        listing: {
          listingAgentName: 'Jane Q. Agent',
          officeName: 'Acme Realty',
          listAgentPhone: '(301) 555-0100',
          listAgentEmail: 'jane@acme.example',
          brokerPhone: '(301) 555-0199',
          brokerEmail: null,
        },
      }),
    );
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getByText('JA')).toBeInTheDocument();
    expect(screen.getByText('Acme Realty')).toBeInTheDocument();
    const card = screen.getByText('Listing Agent').parentElement as HTMLElement;
    expect(within(card).queryByText(/listing courtesy of/i)).toBeNull();
    expect(screen.getByRole('link', { name: /\(301\) 555-0100/ })).toHaveAttribute(
      'href',
      'tel:3015550100',
    );
    expect(screen.getByRole('link', { name: /jane@acme\.example/ })).toHaveAttribute(
      'href',
      'mailto:jane@acme.example',
    );
    expect(screen.getByText(/Brokered by Real Broker, LLC/)).toBeInTheDocument();
  });

  it('leads with the office and its initial when the feed has no agent name', async () => {
    const view = toListingDetailView(
      aListingDetail({ listing: { listingAgentName: null, officeName: 'Acme Realty' } }),
    );
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getByText('Listing Office')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});

describe('ListingDetailContent — phone pass (#572)', () => {
  it('holds the CTA bar at the screen edge, clear of the home indicator, with 44px buttons', async () => {
    const view = toListingDetailView(aListingDetail());
    await renderAndSettle(<ListingDetailContent listing={view} />);
    const bar = screen.getByTestId('listing-mobile-bar');
    expect(bar.className).toMatch(/\bsticky\b/);
    expect(bar.className).toMatch(/\bbottom-0\b/);
    expect(bar.innerHTML).toContain('env(safe-area-inset-bottom)');
    for (const name of ['Message', 'Schedule Tour']) {
      expect(within(bar).getByRole('button', { name }).className).toMatch(/\bmin-h-11\b/);
    }
  });

  it('makes the Share, Save and Back buttons 44px square on a phone', async () => {
    const view = toListingDetailView(aListingDetail());
    await renderAndSettle(<ListingDetailContent listing={view} onClose={jest.fn()} />);
    for (const name of ['Share', 'Save', 'Go back']) {
      expect(screen.getByRole('button', { name }).className).toMatch(/\bh-11\b/);
      expect(screen.getByRole('button', { name }).className).toMatch(/\bw-11\b/);
    }
  });
});

describe('ListingDetailContent — Nearby homes without a panel (#572)', () => {
  it('renders the row directly on the page, with no bordered white box around it', async () => {
    const view = toListingDetailView(aListingDetail());
    const { container } = await renderAndSettle(
      <ListingDetailContent listing={view} nearby={[aListingCardRow()]} />,
    );
    const nearby = container.querySelector('#nearby') as HTMLElement;
    expect(nearby).not.toBeNull();
    expect(nearby.className).not.toMatch(/\b(border|bg-white|rounded-2xl|p-\d|px-\d)\b/);
    expect(within(nearby).getByRole('heading', { name: /nearby homes/i })).toBeInTheDocument();
  });

  it('gives the facts summary rows a 44px tap target', async () => {
    const view = toListingDetailView(aListingDetail());
    const { container } = await renderAndSettle(<ListingDetailContent listing={view} />);
    const summaries = container.querySelectorAll('#facts summary');
    expect(summaries.length).toBeGreaterThan(0);
    summaries.forEach((s) => expect(s.className).toMatch(/\bmin-h-11\b/));
  });
});
