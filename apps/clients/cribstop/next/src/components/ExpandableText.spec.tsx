import { fireEvent, render, screen } from '@testing-library/react';
import ExpandableText from './ExpandableText';

/** jsdom has no layout, so the spec sets the two heights the component compares. */
function setHeights(scrollHeight: number, clientHeight: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
  });
}

describe('ExpandableText', () => {
  afterEach(() => setHeights(0, 0));

  it('shows no button when the text fits', () => {
    setHeights(100, 100);
    render(<ExpandableText text="A short description." />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('clamps a long text and opens it with "…more"', () => {
    setHeights(400, 120);
    render(<ExpandableText text="A long description." />);

    const text = screen.getByText('A long description.');
    expect(text.className).toMatch(/line-clamp-5/);

    const more = screen.getByRole('button', { name: '…more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);

    expect(text.className).not.toMatch(/line-clamp-5/);
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(less);
    expect(text.className).toMatch(/line-clamp-5/);
  });
});
