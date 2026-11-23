/**
 * #946, #1048. The phone brand line is the shared `BrandLockup`: "CRIBSTOP at Real Broker, LLC"
 * (MD COMAR 09.11.02.01G). Cribstop leads (stakeholder ruling 2026-11-18). The brokerage stays
 * legible: ink, semibold, at least 12px.
 */
jest.mock('./NavBar', () => ({ __esModule: true, default: () => <nav data-testid="navbar" /> }));

import { renderToString } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import SiteHeader from './SiteHeader';
import { BRAND } from '@/lib/brand';

const line = () => screen.getByTestId('mobile-brand-line');

describe('SiteHeader phone brand line', () => {
  it('reads "<siteName> at <brokerage>" with real spaces', () => {
    render(<SiteHeader />);
    const link = line().querySelector('a')!;
    expect(link.textContent).toBe(`${BRAND.siteName} at ${BRAND.brokerage}`);
    expect(BRAND.brokerage).toBe('Real Broker, LLC');
    expect(BRAND.siteWordmark.join('')).toBe(BRAND.siteName);
  });

  it('joins the names with "at" and nothing else: no image or symbol', () => {
    render(<SiteHeader />);
    const link = line().querySelector('a')!;
    expect(link.querySelector('img, svg, picture')).toBeNull();
    expect(screen.getByText('at').tagName).toBe('SPAN');
  });

  it('keeps the brokerage legible: semibold ink, never below 12px', () => {
    render(<SiteHeader />);
    const brokerage = screen.getByText(BRAND.brokerage);
    expect(brokerage.className).toContain('font-semibold');
    expect(brokerage.className).toContain('text-ink');
    expect(brokerage.parentElement!.className).toMatch(/text-xs|text-\[13px\]|text-sm/);
  });

  it('is one link to / that keeps its visible name', () => {
    render(<SiteHeader />);
    const link = line().querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/');
    expect(link.hasAttribute('aria-label')).toBe(false);
    expect(line().querySelector('[aria-hidden]')).toBeNull();
  });

  it('is 28px, not sticky, first in the page, and hidden at md and up', () => {
    render(<SiteHeader />);
    expect(line().className).toContain('h-7');
    expect(line().className).toContain('md:hidden');
    expect(line().className).not.toMatch(/sticky|fixed/);
    expect(line().parentElement!.firstElementChild).toBe(line());
  });

  it('is in the server HTML', () => {
    const html = renderToString(<SiteHeader />);
    expect(html).toContain('data-testid="mobile-brand-line"');
    expect(html).toContain(BRAND.brokerage);
  });
});
