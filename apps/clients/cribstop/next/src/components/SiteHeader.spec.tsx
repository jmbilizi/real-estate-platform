/**
 * The header has no brand text line (stakeholder decision 2026-11-24). The brand is the "cs" mark
 * in the header row (`BrandMark` in `NavBar`), the same at every width.
 */
jest.mock('./NavBar', () => ({ __esModule: true, default: () => <nav data-testid="navbar" /> }));

import { render, screen } from '@testing-library/react';
import SiteHeader from './SiteHeader';

describe('SiteHeader', () => {
  it('is the sticky header row only, with no brand line above it', () => {
    const { container } = render(<SiteHeader />);
    expect(screen.queryByTestId('mobile-brand-line')).toBeNull();
    expect(container.children).toHaveLength(1);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('sticky');
    expect(wrapper.contains(screen.getByTestId('navbar'))).toBe(true);
  });
});
