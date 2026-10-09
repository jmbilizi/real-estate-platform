import { render, screen } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import ListingCard from './ListingCard';
import { ListingCardSkeleton } from './listing/ListingStates';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: jest.fn(), isSaved: () => false }),
}));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

describe('price change on the card (#717)', () => {
  const NOW = '2026-10-08T12:00:00.000Z';
  const CUT = { price: 2_197_500, previousPrice: 2_297_500 };

  function renderAt(overrides: Parameters<typeof aListingCardRow>[0]) {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    return render(<ListingCard listing={aListingCardRow({ status: 'Active', ...overrides })} />);
  }

  afterEach(() => jest.useRealTimers());

  const line = () => document.querySelector('.listing-card-change-line');
  const inline = () => document.querySelector('.listing-card-change-inline');

  it('shows the arrow and the amount, with the day inside 14 days', () => {
    renderAt({ ...CUT, priceChangedAt: '2026-10-02T00:00:00.000Z' });

    expect(line()?.textContent).toContain('↓ $100K · Oct 2');
    expect(inline()?.textContent).toContain('(↓ $100K · Oct 2)');
  });

  it('gives a screen reader the full amount', () => {
    renderAt({ ...CUT, priceChangedAt: '2026-09-01T00:00:00.000Z' });

    expect(line()?.querySelector('.sr-only')?.textContent).toBe('Price reduced by $100,000');
    expect(line()?.querySelector('[aria-hidden="true"]')?.textContent).toBe('↓ $100K');
  });

  it('shows an increase with the same markup and no alarm color', () => {
    renderAt({
      price: 2_397_500,
      previousPrice: 2_297_500,
      priceChangedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(line()?.textContent).toContain('↑ $100K');
    expect(line()?.className).toContain('text-ink-body');
    expect(line()?.className).not.toMatch(/red|rose|amber|green|emerald/);
  });

  it('names no day for a change older than 14 days', () => {
    renderAt({ ...CUT, priceChangedAt: '2026-09-01T00:00:00.000Z' });

    expect(line()?.textContent).not.toContain('·');
  });

  it('shows nothing for a change older than 90 days', () => {
    renderAt({ ...CUT, priceChangedAt: '2026-07-01T00:00:00.000Z' });

    expect(line()).toBeNull();
    expect(inline()).toBeNull();
  });

  it('shows nothing with no earlier price', () => {
    renderAt({ price: 500_000 });

    expect(line()).toBeNull();
  });

  it('shows nothing when an older service sends neither field', () => {
    const row = { ...aListingCardRow({ status: 'Active' }) } as Record<string, unknown>;
    delete row.previousPrice;
    delete row.priceChangedAt;

    render(<ListingCard listing={row as unknown as ReturnType<typeof aListingCardRow>} />);

    expect(line()).toBeNull();
  });

  it('keeps the Price reduced pill on a cut', () => {
    renderAt({ ...CUT, priceReduced: true, priceChangedAt: '2026-10-02T00:00:00.000Z' });

    expect(screen.getByText('Price reduced')).toBeInTheDocument();
  });

  it('drops the Price reduced pill behind an increase', () => {
    renderAt({
      price: 2_397_500,
      previousPrice: 2_297_500,
      priceReduced: true,
      priceChangedAt: '2026-10-02T00:00:00.000Z',
    });

    expect(screen.queryByText('Price reduced')).not.toBeInTheDocument();
  });

  it('leaves the loading card without the second line, so its height does not jump on load', () => {
    render(<ListingCardSkeleton />);

    expect(document.querySelector('.listing-card-change-line')).toBeNull();
    expect(document.querySelector('.listing-card-change-inline')).not.toBeNull();
  });
});
