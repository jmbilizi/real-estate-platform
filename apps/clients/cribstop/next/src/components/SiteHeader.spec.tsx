/** #946. The phone brand line reads "CRIBSTOP at Real Broker, LLC" (MD COMAR 09.11.02.01G). */
jest.mock('./NavBar', () => ({ __esModule: true, default: () => <nav data-testid="navbar" /> }));

import { renderToString } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import SiteHeader from './SiteHeader';
import { BRAND } from '@/lib/brand';

const line = () => screen.getByTestId('mobile-brand-line');
const part = (text: string) => screen.getByText(text);
const px = (el: HTMLElement) =>
  el.className.includes('text-sm') ? 14 : el.className.includes('text-xs') ? 12 : NaN;

describe('SiteHeader phone brand line', () => {
  it('reads exactly "<siteName> at <brokerage>"', () => {
    render(<SiteHeader />);
    const spans = Array.from(line().querySelectorAll('span')).map((s) => s.textContent);
    expect(spans).toEqual([BRAND.siteName, 'at', 'Real Broker, LLC']);
    expect(BRAND.brokerage).toBe('Real Broker, LLC');
    expect(part(BRAND.siteName).className).toContain('uppercase');
  });

  it('joins the names with "at" and nothing else', () => {
    render(<SiteHeader />);
    const link = line().querySelector('a')!;
    expect(link.querySelector('img, svg, picture')).toBeNull();
    expect(Array.from(link.children).map((c) => c.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN']);
  });

  it('keeps the brokerage at 14px semibold ink, never smaller than the site name', () => {
    render(<SiteHeader />);
    expect(px(part(BRAND.brokerage))).toBe(14);
    expect(px(part(BRAND.siteName))).toBe(12);
    expect(px(part(BRAND.brokerage))).toBeGreaterThanOrEqual(px(part(BRAND.siteName)));
    expect(part(BRAND.brokerage).className).toContain('font-semibold');
    expect(part(BRAND.brokerage).className).toContain('text-ink');
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
