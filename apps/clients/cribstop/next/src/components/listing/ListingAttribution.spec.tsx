import { render, screen } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import ListingAttribution from './ListingAttribution';

/**
 * A realistic long Bright MLS row: a long office name and a long broker email, the shape that
 * overflowed the search card (#273). `listedBy` deliberately does not end with `officeName`, so
 * the courtesy line renders too — the worst case, all three lines present.
 */
function aBrightMlsRow() {
  return aListingCardRow({
    source: 'brightMLS',
    listedBy: 'Jane Q. Agentworth-Fairweather III – Long & Foster Real Estate, Inc.',
    listingAgentName: 'Jane Q. Agentworth-Fairweather III',
    officeName: 'Long & Foster Real Estate, Inc. — Bethesda Gateway Regional Office',
    brokerPhone: '(301) 555-0199',
    brokerEmail: 'jane.q.agentworth-fairweather.iii@longandfosterrealestatebethesda.example.com',
  });
}

describe('ListingAttribution — brightMLS row, compact', () => {
  it('renders each fact as one truncated line with a title, and drops the redundant agent line', () => {
    const row = aBrightMlsRow();
    const { container } = render(
      <ListingAttribution attribution={row} source={row.source} compact />,
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
    const { container } = render(<ListingAttribution attribution={row} source={row.source} />);

    // The redundant standalone line is back, and nothing is truncated.
    expect(screen.getByText(row.listingAgentName!)).toBeInTheDocument();
    const lines = container.querySelectorAll(':scope > p');
    lines.forEach((line) => expect(line.className).not.toContain('truncate'));
  });

  it('leaves the detail page\'s density="courtesy" rendering unchanged', () => {
    // The detail page passes `density="courtesy"` on an `internal` row and never passes
    // `compact`. This pins that the one-sentence disclosure form is untouched by this change.
    const row = aListingCardRow({ source: 'internal' });
    render(<ListingAttribution attribution={row} source={row.source} density="courtesy" />);

    expect(
      screen.getByText(`Listing courtesy of ${row.officeName}. Listed by ${row.listedBy}.`),
    ).toBeInTheDocument();
  });
});
