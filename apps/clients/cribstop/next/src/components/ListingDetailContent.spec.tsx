import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

describe('ListingDetailContent — NAR 7.58 attribution', () => {
  /**
   * The disclosure panel always asks `ListingAttribution` for the reduced `courtesy` density — the
   * Listing Agent card in the sidebar already carries the name, office, phone and email, so the
   * courtesy line exists to avoid repeating all of it. `ListingAttribution`'s `showFullBlock` still
   * treats `density === 'courtesy' && source === 'brightMLS'` as the full block, unchanged by #305
   * (which only removed the card default's, `density === 'auto'`, dependence on `source`). Scoped
   * to the disclosure panel because the sidebar's Listing Agent card independently renders the same
   * agent name, phone and email as plain text.
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
    expect(within(card).queryByRole('button')).toBeNull();
    expect(within(card).queryByText(/Brokered by/)).toBeNull();
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

describe('ListingDetailContent — buyer-agent card (#591)', () => {
  it('holds the CTAs and the broker line, below the Listing Agent card', async () => {
    const onRequestTour = jest.fn();
    const onMessageAgent = jest.fn();
    const view = toListingDetailView(aListingDetail());
    await renderAndSettle(
      <ListingDetailContent
        listing={view}
        onRequestTour={onRequestTour}
        onMessageAgent={onMessageAgent}
      />,
    );

    const card = screen.getByTestId('buyer-agent-card');
    expect(card.textContent).toContain('Cribstop, brokered by Real Broker, LLC');
    expect(card.textContent).toContain('may require a written buyer agreement');
    expect(within(card).getByText(/Brokered by Real Broker, LLC/)).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/listing agent|confirmed|scheduled|rebate|commission/i);
    const agentCard = screen.getByText(/^Listing (Agent|Office)$/).parentElement as HTMLElement;
    expect(agentCard.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The card and the phone bar share the handlers.
    for (const tour of screen.getAllByRole('button', { name: 'Request a Tour' })) {
      fireEvent.click(tour);
    }
    for (const message of screen.getAllByRole('button', { name: 'Message Agent' })) {
      fireEvent.click(message);
    }
    expect(onRequestTour).toHaveBeenCalledTimes(2);
    expect(onMessageAgent).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: /listing agent|schedule/i })).toBeNull();
  });
});
