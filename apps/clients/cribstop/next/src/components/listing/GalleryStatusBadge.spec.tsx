import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import GalleryStatusBadge from './GalleryStatusBadge';

const NOW = new Date('2026-10-03T16:00:00.000Z').getTime();

function renderBadge(overrides: Partial<ComponentProps<typeof GalleryStatusBadge>> = {}) {
  return render(
    <GalleryStatusBadge
      status="Active"
      listingType="sale"
      listedAt="2026-10-02T00:00:00.000Z"
      listedAtPrecise={null}
      comingSoonDate={null}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});
afterEach(() => jest.useRealTimers());

describe('GalleryStatusBadge (#565)', () => {
  it('shows the age for a home listed under a week ago', () => {
    renderBadge();
    expect(screen.getByTestId('gallery-status-badge')).toHaveTextContent('For sale · 1 day ago');
  });

  it('reads For rent for a rental', () => {
    renderBadge({ listingType: 'rent' });
    expect(screen.getByTestId('gallery-status-badge')).toHaveTextContent('For rent · 1 day ago');
  });

  it('omits the age at 7 days or older', () => {
    renderBadge({ listedAt: '2026-09-26T00:00:00.000Z' });
    expect(screen.getByTestId('gallery-status-badge')).toHaveTextContent(/^For sale$/);
  });

  it('omits the age when the list date is unknown', () => {
    renderBadge({ listedAt: null });
    expect(screen.getByTestId('gallery-status-badge')).toHaveTextContent(/^For sale$/);
  });

  it('never shows an age for Sold', () => {
    renderBadge({ status: 'Sold', listingType: 'sold' });
    expect(screen.getByTestId('gallery-status-badge')).toHaveTextContent(/^Sold$/);
  });

  it('keeps the Coming Soon wording with its date and no age', () => {
    renderBadge({ status: 'Coming Soon', comingSoonDate: '2026-10-15T00:00:00.000Z' });
    expect(screen.getByTestId('gallery-status-badge')).toHaveTextContent(/^Coming soon Oct 15$/);
  });

  it.each([
    ['Off market', 'Off market'],
    ['Under Contract', 'Under contract'],
  ])('maps the market status %s', (statusLabel, text) => {
    renderBadge({ statusLabel, listedAt: null });
    expect(screen.getByTestId('gallery-status-badge')).toHaveTextContent(new RegExp(`^${text}$`));
  });
});
