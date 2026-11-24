import { renderToString } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import BrandMark from './BrandMark';
import { BRAND } from '@/lib/brand';

describe('BrandMark', () => {
  it('shows the drawn "CS" only, on the brand color, with no breakpoint variant', () => {
    render(<BrandMark />);
    const link = screen.getByRole('link');
    expect(link.querySelector('svg[data-brand-mark="cs"]')).not.toBeNull();
    expect(link.textContent).toBe('');
    expect(link.className).toContain('bg-brand');
    expect(link.className).toContain('text-white');
    expect(link.className).not.toMatch(/(sm|md|lg|xl):/);
  });

  it('is one link to / named with the site name and the brokerage name', () => {
    render(<BrandMark />);
    const link = screen.getByRole('link', {
      name: `${BRAND.siteName} at ${BRAND.brokerage}: home`,
    });
    expect(link.getAttribute('href')).toBe('/');
  });

  it('is in the server HTML with the brokerage name', () => {
    const html = renderToString(<BrandMark />);
    expect(html).toContain(BRAND.brokerage);
    expect(html).toContain('data-brand-mark="cs"');
  });
});
