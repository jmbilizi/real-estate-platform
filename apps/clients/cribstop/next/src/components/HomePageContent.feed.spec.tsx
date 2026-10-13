import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { HomeFeedResponse } from '@cribstop/property-contracts';
import { aListingCardRow } from '@/test/fixtures';
import { getListingsMeta, getNeighborhoods, searchListings } from '@/lib/api/listings';
import { getHomeFeed } from '@/lib/api/home-feed';
import { trackEvent } from '@/lib/analytics';
import { bucketOf } from '@/lib/home-feed';
import HomePageContent from './HomePageContent';

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
  getNeighborhoods: jest.fn(),
}));
jest.mock('@/lib/api/saved-homes', () => ({ listRecentSavedHomes: jest.fn() }));
jest.mock('@/lib/api/home-feed', () => ({ getHomeFeed: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('@/lib/useImpression', () => ({
  useImpression: (key: string | null, onImpression: () => void) => (node: HTMLElement | null) => {
    if (node && key) onImpression();
  },
}));
jest.mock('@/lib/context', () => ({
  useApp: () => ({
    listingType: 'sale',
    toggleSave: jest.fn(),
    isSaved: () => false,
    user: null,
    savedPropertyIds: new Set(),
  }),
}));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

let mockTarget: { city: string; state: string; source: string } | null = null;
jest.mock('@/lib/useHomeTarget', () => ({
  useHomeTarget: () => ({
    target: mockTarget && { ...mockTarget, confidence: 0.9, radiusKm: 8 },
    loading: false,
  }),
}));

let mockAnonId: string | null = 'a'.repeat(32);
jest.mock('@/lib/anon-id', () => ({ getAnonId: () => mockAnonId }));

let mockProfile: { items: unknown[]; places: string[] } | null = null;
jest.mock('@/lib/feed-profile', () => ({
  isPersonalisationEnabled: () => mockProfile !== null,
  readItems: () => [],
  getFeedRequestProfile: () => mockProfile,
}));

const mockedGetHomeFeed = getHomeFeed as jest.Mock;
const mockedTrack = trackEvent as jest.Mock;
const ON = { enabled: true, rolloutPct: 100 };

const WARM = { items: [], places: ['Rockville, MD'] };
const FEED_TITLE = 'Based on your activity in Rockville, MD';

function feedResponse(overrides: Partial<HomeFeedResponse> = {}): HomeFeedResponse {
  const card = aListingCardRow();
  return {
    modelVersion: 'v1-rules',
    variant: 'v1',
    rows: [
      {
        rowId: 'picked',
        title: 'Picked for you in Rockville, MD',
        modelVersion: 'v1-rules',
        variant: 'v1',
        listings: [
          { listing: card, explore: false },
          { listing: aListingCardRow({ id: 'explore-1', propertyId: 'p-explore' }), explore: true },
        ],
      },
    ],
    ...overrides,
  };
}

function titles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('h2')].map((h) => h.textContent ?? '');
}

describe('HomePageContent home feed (#836)', () => {
  beforeEach(() => {
    (getListingsMeta as jest.Mock).mockResolvedValue({
      dataUpdatedAt: '2026-04-20T18:00:00.000Z',
      sources: ['internal'],
      listingCount: 13,
    });
    (searchListings as jest.Mock).mockResolvedValue({
      results: [aListingCardRow()],
      total: 1,
      page: 1,
      pageSize: 8,
      pageCount: 1,
      appliedFilters: {},
    });
    (getNeighborhoods as jest.Mock).mockResolvedValue({ results: [], total: 0 });
    mockTarget = { city: 'Rockville', state: 'MD', source: 'last-search' };
    mockAnonId = 'a'.repeat(32);
    mockProfile = WARM;
  });

  afterEach(() => {
    cleanup();
    mockedGetHomeFeed.mockReset();
    mockedTrack.mockReset();
  });

  async function settledTitles(ui: React.ReactElement) {
    const { container } = render(ui);
    await waitFor(() => expect(screen.getByText('Explore neighborhoods')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId('home-feed-skeleton')).not.toBeInTheDocument());
    return { container, rows: titles(container) };
  }

  it("flag off renders exactly today's rows and never calls the feed", async () => {
    const baseline = await settledTitles(<HomePageContent />);
    const html = baseline.container.innerHTML;
    cleanup();
    const off = await settledTitles(
      <HomePageContent homeFeed={{ enabled: false, rolloutPct: 100 }} />,
    );

    expect(off.container.innerHTML).toBe(html);
    expect(off.rows).toMatchSnapshot();
    expect(mockedGetHomeFeed).not.toHaveBeenCalled();
  });

  it("a rollout of 0 percent renders today's rows", async () => {
    const { rows } = await settledTitles(
      <HomePageContent homeFeed={{ enabled: true, rolloutPct: 0 }} />,
    );
    expect(rows).not.toContain(FEED_TITLE);
    expect(mockedGetHomeFeed).not.toHaveBeenCalled();
  });

  it("the control bucket renders today's rows", async () => {
    const control = bucketOf(mockAnonId as string) + 1;
    // A rollout at or below the bucket leaves this visitor in control.
    const { rows } = await settledTitles(
      <HomePageContent homeFeed={{ enabled: true, rolloutPct: control - 1 }} />,
    );
    expect(rows).toContain('Newest homes for sale');
    expect(mockedGetHomeFeed).not.toHaveBeenCalled();
  });

  it("no anon id (opt-out or GPC) renders today's rows", async () => {
    mockAnonId = null;
    mockProfile = null;
    const { rows } = await settledTitles(<HomePageContent homeFeed={ON} />);
    expect(rows).toContain('Newest homes for sale');
    expect(mockedGetHomeFeed).not.toHaveBeenCalled();
  });

  it("a cold visit renders today's rows", async () => {
    mockProfile = { items: [], places: [] };
    const { rows } = await settledTitles(<HomePageContent homeFeed={ON} />);
    expect(rows).toContain('Newest homes for sale');
    expect(mockedGetHomeFeed).not.toHaveBeenCalled();
  });

  it('an IP-derived place never reaches the feed', async () => {
    mockTarget = { city: 'Rockville', state: 'MD', source: 'ip' };
    const { rows } = await settledTitles(<HomePageContent homeFeed={ON} />);
    expect(rows).toContain('Newest homes for sale');
    expect(mockedGetHomeFeed).not.toHaveBeenCalled();
  });

  it('treatment shows the feed rows and sends feed events with variant and model version', async () => {
    mockedGetHomeFeed.mockResolvedValue(feedResponse());
    const { rows } = await settledTitles(<HomePageContent homeFeed={ON} />);

    expect(rows).toContain(FEED_TITLE);
    expect(rows).not.toContain('Newest homes for sale');
    expect(mockedGetHomeFeed.mock.calls[0][0]).toMatchObject({
      target: { city: 'Rockville', state: 'MD' },
      side: 'sale',
      variant: 'v1',
    });
    const impressions = mockedTrack.mock.calls.filter(([name]) => name === 'feed_impression');
    expect(impressions).toHaveLength(2);
    expect(impressions[0][1].props).toEqual({
      row_id: 'picked',
      position: 0,
      variant: 'v1',
      model_version: 'v1-rules',
      explore: false,
    });
    expect(impressions[1][1].props).toMatchObject({ position: 1, explore: true });
  });

  it("a fallback answer renders today's rows", async () => {
    mockedGetHomeFeed.mockResolvedValue(feedResponse({ variant: 'fallback' }));
    const { rows } = await settledTitles(<HomePageContent homeFeed={ON} />);
    expect(rows).not.toContain(FEED_TITLE);
    expect(rows).toContain('Newest homes for sale');
    expect(mockedTrack.mock.calls.filter(([n]) => n === 'feed_impression')).toHaveLength(0);
  });

  it("an empty answer renders today's rows", async () => {
    mockedGetHomeFeed.mockResolvedValue(feedResponse({ rows: [] }));
    const { rows } = await settledTitles(<HomePageContent homeFeed={ON} />);
    expect(rows).toContain('Newest homes for sale');
  });

  it("an endpoint error renders today's rows and no error text", async () => {
    mockedGetHomeFeed.mockRejectedValue(new Error('home feed 502'));
    const { rows } = await settledTitles(<HomePageContent homeFeed={ON} />);
    expect(rows).toContain('Newest homes for sale');
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tap to retry/i)).not.toBeInTheDocument();
  });

  it('shows a skeleton with card rows while the feed loads', async () => {
    mockedGetHomeFeed.mockReturnValue(new Promise(() => undefined));
    render(<HomePageContent homeFeed={ON} />);
    const skeleton = await screen.findByTestId('home-feed-skeleton');
    expect(skeleton.querySelectorAll('section')).toHaveLength(3);
    expect(screen.queryByText('Newest homes for sale')).not.toBeInTheDocument();
  });
});
