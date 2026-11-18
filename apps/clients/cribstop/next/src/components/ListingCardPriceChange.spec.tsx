import { render, screen } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import ListingCard from './ListingCard';

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

  const change = () => document.querySelector('.listing-card-change');

  it('shows the cut as the photo badge, with the amount and no day (#1048)', () => {
    renderAt({ ...CUT, priceChangedAt: '2026-10-02T00:00:00.000Z' });

    expect(change()?.querySelector('[aria-hidden="true"]')?.textContent).toBe('Price cut $100K');
    expect(change()?.textContent).not.toContain('Oct 2');
    expect(change()?.closest('.listing-card-media')).not.toBeNull();
  });

  it('gives a screen reader the full amount', () => {
    renderAt({ ...CUT, priceChangedAt: '2026-09-01T00:00:00.000Z' });

    expect(change()?.querySelector('.sr-only')?.textContent).toBe('Price reduced by $100,000');
    expect(change()?.querySelector('[aria-hidden="true"]')?.textContent).toBe('Price cut $100K');
  });

  it('shows an increase with the same markup and no alarm color', () => {
    renderAt({
      price: 2_397_500,
      previousPrice: 2_297_500,
      priceChangedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(change()?.textContent).toContain('Price up $100K');
    expect(change()?.className).toContain('text-ink');
    expect(change()?.className).not.toMatch(/red|rose|amber|green|emerald/);
  });

  it('shows nothing for a change older than 90 days', () => {
    renderAt({ ...CUT, priceChangedAt: '2026-07-01T00:00:00.000Z' });

    expect(change()).toBeNull();
  });

  it('shows nothing with no earlier price', () => {
    renderAt({ price: 500_000 });

    expect(change()).toBeNull();
  });

  it('shows nothing when an older service sends neither field', () => {
    const row = { ...aListingCardRow({ status: 'Active' }) } as Record<string, unknown>;
    delete row.previousPrice;
    delete row.priceChangedAt;

    render(<ListingCard listing={row as unknown as ReturnType<typeof aListingCardRow>} />);

    expect(change()).toBeNull();
  });

  it('drops the Price reduced pill when the amount shows, so the fact shows once (#1048)', () => {
    renderAt({ ...CUT, priceReduced: true, priceChangedAt: '2026-10-02T00:00:00.000Z' });

    expect(screen.queryByText('Price reduced')).not.toBeInTheDocument();
    expect(change()?.textContent).toContain('Price cut $100K');
  });

  it('keeps the Price reduced pill when the card has no amount to show', () => {
    renderAt({ price: 500_000, priceReduced: true });

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

  it('adds no line to the info block, so card heights match (#1048)', () => {
    renderAt({ ...CUT, priceChangedAt: '2026-10-02T00:00:00.000Z' });
    const withChange = document.querySelectorAll('.listing-card-root .pt-1\\.5 > *').length;
    document.body.innerHTML = '';
    renderAt({ price: 500_000 });
    const without = document.querySelectorAll('.listing-card-root .pt-1\\.5 > *').length;

    expect(withChange).toBe(without);
  });
});
