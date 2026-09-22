import { render, screen } from '@testing-library/react';
import type { ListingCardRow } from '@cribstop/property-contracts';
import { aListingCardRow } from '@/test/fixtures';
import ListingAttribution from './ListingAttribution';

/**
 * A realistic long Bright MLS row: a long office name and a long broker email, the shape that
 * overflowed the search card (#273). `listedBy` deliberately does not end with `officeName`, so
 * the courtesy line renders too — the worst case, all three lines present.
 */
function aBrightMlsRow(overrides: Partial<ListingCardRow> = {}) {
  return aListingCardRow({
    source: 'brightMLS',
    listedBy: 'Jane Q. Agentworth-Fairweather III – Long & Foster Real Estate, Inc.',
    listingAgentName: 'Jane Q. Agentworth-Fairweather III',
    officeName: 'Long & Foster Real Estate, Inc. — Bethesda Gateway Regional Office',
    brokerPhone: '(301) 555-0199',
    brokerEmail: 'jane.q.agentworth-fairweather.iii@longandfosterrealestatebethesda.example.com',
    ...overrides,
  });
}

describe('ListingAttribution — card default (density="auto"), every source', () => {
  it('renders one courtesy line for a brightMLS row, same as internal (#305)', () => {
    const row = aBrightMlsRow();
    render(<ListingAttribution attribution={row} source={row.source} compact />);

    expect(screen.getByText(`Listing courtesy of ${row.officeName}`)).toBeInTheDocument();
    expect(screen.queryByText(row.listedBy)).not.toBeInTheDocument();
    expect(screen.queryByText(row.listingAgentName!)).not.toBeInTheDocument();
    expect(screen.queryByText(row.brokerPhone!)).not.toBeInTheDocument();
    expect(screen.queryByText(row.brokerEmail!)).not.toBeInTheDocument();
  });

  it('renders one courtesy line for an internal row', () => {
    const row = aListingCardRow({ source: 'internal' });
    render(<ListingAttribution attribution={row} source={row.source} compact />);

    expect(screen.getByText(`Listing courtesy of ${row.officeName}`)).toBeInTheDocument();
  });

  it('renders one courtesy line for an other row', () => {
    const row = aListingCardRow({ source: 'other' });
    render(<ListingAttribution attribution={row} source={row.source} compact />);

    expect(screen.getByText(`Listing courtesy of ${row.officeName}`)).toBeInTheDocument();
  });

  it('truncates a long office name to one line, keeping the full text in the DOM via title', () => {
    const row = aBrightMlsRow();
    render(<ListingAttribution attribution={row} source={row.source} />);

    const line = screen.getByText(`Listing courtesy of ${row.officeName}`);
    expect(line.className).toContain('truncate');
    expect(line).toHaveAttribute('title', row.officeName);
  });
});

describe('ListingAttribution — density="full", the kept IDX block', () => {
  it('renders each fact as one truncated line with a title, and drops the redundant agent line', () => {
    const row = aBrightMlsRow();
    const { container } = render(
      <ListingAttribution attribution={row} source={row.source} density="full" compact />,
    );

    // The redundant standalone `listingAgentName` line is gone in compact mode. The name is
    // still present inside `listedBy`, which does render.
    expect(screen.queryByText(row.listingAgentName!)).not.toBeInTheDocument();
    expect(screen.getByText(row.listedBy)).toBeInTheDocument();

    // At most 3 lines, each truncated with its full text preserved via `title` (never clipped
    // out of the DOM — NAR 7.58 disclosure stays present, only the presentation is bounded).
    const lines = container.querySelectorAll(':scope > p');
    expect(lines.length).toBeLessThanOrEqual(3);
    lines.forEach((line) => {
      expect(line.className).toContain('truncate');
      expect(line.getAttribute('title')).toBeTruthy();
    });

    // The firm name and a contact method are both still in the DOM.
    expect(container.textContent).toContain(row.officeName);
    expect(screen.getByText(row.brokerPhone!)).toBeInTheDocument();
    expect(screen.getByText(row.brokerEmail!)).toBeInTheDocument();
  });

  it('renders the same full, non-truncated block when compact is omitted', () => {
    const row = aBrightMlsRow();
    const { container } = render(
      <ListingAttribution attribution={row} source={row.source} density="full" />,
    );

    // The redundant standalone line is back, and nothing is truncated.
    expect(screen.getByText(row.listingAgentName!)).toBeInTheDocument();
    const lines = container.querySelectorAll(':scope > p');
    lines.forEach((line) => expect(line.className).not.toContain('truncate'));
  });

  it('renders the full block for an internal row too — density="full" is not source-gated', () => {
    const row = aListingCardRow({ source: 'internal' });
    render(<ListingAttribution attribution={row} source={row.source} density="full" compact />);

    expect(screen.getByText(row.listedBy)).toBeInTheDocument();
    expect(screen.getByText(`Listing courtesy of ${row.officeName}`)).toBeInTheDocument();
  });

  it('keeps the full block at or above the median type size used for the listing data', () => {
    // Listing data on the card renders at 14px (location), 12px (stats) and 14px (price), so the
    // median is 14px — `text-sm`. This is the block 7.58's typeface floor still governs (the
    // detail page reaches it for a brightMLS row), so the floor stays pinned here.
    const row = aBrightMlsRow();
    render(<ListingAttribution attribution={row} source={row.source} density="full" />);
    const block = screen.getByText(row.listedBy).parentElement;

    expect(block?.className).toContain('text-sm');
    expect(block?.className).not.toMatch(/text-\[1[0-3]px\]|text-xs/);
  });

  it('still shows the firm name as its own line when listedBy already ends with officeName', () => {
    // `listedBy` is "<agent> – <office>", so when it already ends with `officeName` the office
    // name sits at the tail of the truncated line — exactly where an ellipsis clips first. The
    // firm must not depend on that clipped tail; the courtesy line carries it instead.
    const row = aBrightMlsRow({
      officeName: 'Long & Foster Real Estate, Inc.',
      listedBy: 'Jane Q. Agentworth-Fairweather III – Long & Foster Real Estate, Inc.',
    });
    const { container } = render(
      <ListingAttribution attribution={row} source={row.source} density="full" compact />,
    );

    const courtesyLine = screen.getByText(`Listing courtesy of ${row.officeName}`);
    expect(courtesyLine).toBeInTheDocument();
    expect(courtesyLine.className).toContain('truncate');
    expect(courtesyLine.getAttribute('title')).toBe(`Listing courtesy of ${row.officeName}`);

    const lines = container.querySelectorAll(':scope > p');
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});

describe('ListingAttribution — detail page', () => {
  it('leaves the detail page\'s density="courtesy" rendering unchanged', () => {
    // The detail page passes `density="courtesy"` on an `internal` row and never passes
    // `compact`. This pins that the one-sentence disclosure form is untouched by #305.
    const row = aListingCardRow({ source: 'internal' });
    render(<ListingAttribution attribution={row} source={row.source} density="courtesy" />);

    expect(
      screen.getByText(`Listing courtesy of ${row.officeName}. Listed by ${row.listedBy}.`),
    ).toBeInTheDocument();
  });
});
