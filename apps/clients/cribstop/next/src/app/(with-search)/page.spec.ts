jest.mock('@/components/HomePageContent', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ScrollSentinel', () => ({ __esModule: true, default: () => null }));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as page from './page';

describe('home page metadata', () => {
  const saved = process.env.SITE_ORIGIN;
  afterEach(() => {
    if (saved === undefined) delete process.env.SITE_ORIGIN;
    else process.env.SITE_ORIGIN = saved;
  });

  it('has title, description, canonical and Open Graph', () => {
    process.env.SITE_ORIGIN = 'https://example.com/';
    const meta = page.generateMetadata();

    expect(meta.title).toEqual({ absolute: 'Real Broker, LLC — Find Your Next Home' });
    expect(meta.description).toContain('Real Broker, LLC');
    expect(meta.alternates?.canonical).toBe('https://example.com/');
    expect(meta.openGraph).toMatchObject({
      siteName: 'Real Broker, LLC',
      url: 'https://example.com/',
    });
  });

  it('publishes no canonical without a vouched origin', () => {
    delete process.env.SITE_ORIGIN;

    expect(page.generateMetadata().alternates).toBeUndefined();
  });
});

describe('home page module', () => {
  // `dynamic` is set for SITE_ORIGIN, not for the feed. The feed flags come from /api/feed-config (#836).
  it('does not read the home feed flags', () => {
    const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toMatch(/HOME_FEED/);
  });
});
