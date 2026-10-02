import { render, screen } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import ListingRow from './ListingRow';
import NeighborhoodRow, { type Neighborhood } from './NeighborhoodRow';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: jest.fn(), isSaved: () => false }),
}));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

const NEIGHBORHOODS: Neighborhood[] = [
  { name: 'Columbia Heights', city: 'Washington', state: 'DC', sale: 207, rent: 93 },
  { name: 'Petworth', city: 'Washington', state: 'DC', sale: 40, rent: 0 },
];

function scrollerOf(container: HTMLElement) {
  return container.querySelector('.snap-x') as HTMLElement;
}

/** #508: the neighborhood row and the property row share one carousel shell. */
describe('carousel parity between NeighborhoodRow and ListingRow (#508)', () => {
  it('hides the arrows below sm in both rows', () => {
    const a = render(<ListingRow title="Featured" listings={[aListingCardRow({ id: '1' })]} />);
    const b = render(<NeighborhoodRow title="Explore" neighborhoods={NEIGHBORHOODS} />);
    for (const c of [a.container, b.container]) {
      const wrapper = c.querySelector('button[aria-label="Scroll left"]')!.parentElement!;
      expect(wrapper.className).toContain('hidden');
      expect(wrapper.className).toContain('sm:flex');
    }
  });

  it('gives both scrollers the same bleed, peek and gap classes', () => {
    const a = render(<ListingRow title="Featured" listings={[aListingCardRow({ id: '1' })]} />);
    const b = render(<NeighborhoodRow title="Explore" neighborhoods={NEIGHBORHOODS} />);
    const listing = scrollerOf(a.container).className;
    const hood = scrollerOf(b.container).className;
    expect(hood).toBe(listing);
    expect(hood).toContain('-mr-6');
    expect(hood).toContain('sm:mr-0');
    expect(hood).toContain('gap-3');
    expect(hood).toContain('sm:gap-5');
  });

  it('gives a neighborhood item and a listing card the same width classes', () => {
    const a = render(<ListingRow title="Featured" listings={[aListingCardRow({ id: '1' })]} />);
    render(<NeighborhoodRow title="Explore" neighborhoods={NEIGHBORHOODS} />);
    const widths = (el: Element) => el.className.split(' ').filter((c) => /(^|:)w-/.test(c));
    const card = scrollerOf(a.container).firstElementChild!;
    const tile = screen
      .getByRole('link', { name: 'Columbia Heights' })
      .closest('div')!.parentElement!;
    expect(widths(tile)).toEqual(widths(card));
    expect(widths(tile)).toContain('2xl:w-[calc((100%-7.5rem)/7)]');
    expect(widths(tile)).toContain('w-[42%]');
  });
});
