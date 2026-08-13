import { render, screen, waitFor } from '@testing-library/react';
import Footer from './Footer';
import { getListingsMeta } from '@/lib/api/listings';

/**
 * The dataset-freshness fetch is independent of any search, so this mocks the API module
 * directly rather than `fetch` — the footer's contract is "what does `getListingsMeta` return",
 * not "what does the network say".
 */
jest.mock('@/lib/api/listings', () => ({
  getListingsMeta: jest.fn(),
}));

const mockedGetListingsMeta = getListingsMeta as jest.Mock;

describe('Footer', () => {
  afterEach(() => {
    mockedGetListingsMeta.mockReset();
  });

  it('omits the "Data last updated" line when dataUpdatedAt is null, and never substitutes today’s date', async () => {
    mockedGetListingsMeta.mockResolvedValue({
      dataUpdatedAt: null,
      sources: ['brightMLS'],
      listingCount: 5,
    });

    render(<Footer />);

    // Wait for the Bright block itself to appear so the assertion below is about the freshness
    // line specifically, not the whole disclosure having failed to render.
    await waitFor(() => expect(screen.getByText('MLS Disclosure')).toBeInTheDocument());

    expect(screen.queryByText(/Data last updated/)).not.toBeInTheDocument();
  });

  it('renders the freshness line, in America/New_York, once a real timestamp resolves', async () => {
    mockedGetListingsMeta.mockResolvedValue({
      dataUpdatedAt: '2026-04-20T18:00:00.000Z',
      sources: ['brightMLS'],
      listingCount: 5,
    });

    render(<Footer />);

    await waitFor(() => expect(screen.getByText(/Data last updated/)).toBeInTheDocument());
    expect(screen.getByText(/Data last updated/).textContent).toMatch(/ET|EDT|EST/);
  });

  it('renders no Bright disclosure block when the dataset has no Bright-sourced row', async () => {
    mockedGetListingsMeta.mockResolvedValue({
      dataUpdatedAt: '2026-04-20T18:00:00.000Z',
      sources: ['internal'],
      listingCount: 5,
    });

    render(<Footer />);

    // Wait on the block that SHOULD appear. Waiting only for the mock to have been called would
    // assert the absences before React had committed the resolved state, so they would pass
    // trivially against the pre-fetch render.
    //
    // Freshness is a fact about our dataset whatever its source, so it must NOT be gated on
    // Bright. Every row is `internal` today, so gating it there would mean the app never showed a
    // freshness value at all despite having a real one.
    await waitFor(() => expect(screen.getByText('Data Disclosure')).toBeInTheDocument());
    expect(screen.getByText(/Data last updated/)).toBeInTheDocument();

    expect(screen.queryByText('MLS Disclosure')).not.toBeInTheDocument();
    expect(screen.queryByText(/BRIGHT Internet Data Exchange/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bright, All Rights Reserved/)).not.toBeInTheDocument();
  });

  it('keeps brokerage identification unconditional, whatever the data source (PRD §6.1)', async () => {
    mockedGetListingsMeta.mockResolvedValue({
      dataUpdatedAt: null,
      sources: [],
      listingCount: 0,
    });

    render(<Footer />);

    await waitFor(() => expect(mockedGetListingsMeta).toHaveBeenCalled());
    await Promise.resolve();

    // Neither disclosure block renders in this state; brand prominence must survive it anyway.
    expect(screen.queryByText('MLS Disclosure')).not.toBeInTheDocument();
    expect(screen.queryByText('Data Disclosure')).not.toBeInTheDocument();
    expect(screen.getByText(/Brokered by Real Broker LLC/)).toBeInTheDocument();
    expect(screen.getByText(/Licensed in MD, DC, and VA/)).toBeInTheDocument();
  });

  it('renders the Bright disclosure block when the dataset includes a Bright-sourced row', async () => {
    mockedGetListingsMeta.mockResolvedValue({
      dataUpdatedAt: '2026-04-20T18:00:00.000Z',
      sources: ['brightMLS', 'internal'],
      listingCount: 5,
    });

    render(<Footer />);

    await waitFor(() => expect(screen.getByText('MLS Disclosure')).toBeInTheDocument());
    expect(screen.getByText(/BRIGHT Internet Data Exchange/)).toBeInTheDocument();
  });

  it('still renders the footer, with no throw and no freshness line, when the meta fetch rejects', async () => {
    mockedGetListingsMeta.mockRejectedValue(new Error('service unavailable'));

    expect(() => render(<Footer />)).not.toThrow();

    await waitFor(() => expect(mockedGetListingsMeta).toHaveBeenCalled());
    await Promise.resolve();

    expect(screen.queryByText(/Data last updated/)).not.toBeInTheDocument();
    expect(screen.queryByText('MLS Disclosure')).not.toBeInTheDocument();
    // Chrome unrelated to the fetch — brand prominence — must still be there.
    expect(screen.getByText('Equal Housing Opportunity')).toBeInTheDocument();
    expect(screen.getByText(/Brokered by Real Broker LLC/)).toBeInTheDocument();
  });
});
