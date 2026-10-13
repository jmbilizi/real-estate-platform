jest.mock('@/components/HomePageContent', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ScrollSentinel', () => ({ __esModule: true, default: () => null }));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as page from './page';
import JsonLd from '@/components/JsonLd';

describe('home page rendering mode', () => {
  const saved = process.env.SITE_ORIGIN;
  afterEach(() => {
    if (saved === undefined) delete process.env.SITE_ORIGIN;
    else process.env.SITE_ORIGIN = saved;
  });

  it('stays cacheable: no force-dynamic export', () => {
    expect((page as Record<string, unknown>).dynamic).not.toBe('force-dynamic');
    expect(page.revalidate).toBeGreaterThan(0);
  });

  const jsonLdChildren = () => {
    const tree = page.default() as { props: { children: unknown[] } };
    return tree.props.children.filter((c) => (c as { type?: unknown } | null)?.type === JsonLd);
  };

  it('publishes JSON-LD from SITE_ORIGIN', () => {
    process.env.SITE_ORIGIN = 'https://example.com';
    const [node] = jsonLdChildren() as { props: { data: { '@graph': { url: string }[] } } }[];
    expect(node.props.data['@graph'][0].url).toBe('https://example.com/');
  });

  it('publishes no JSON-LD without SITE_ORIGIN', () => {
    delete process.env.SITE_ORIGIN;
    expect(jsonLdChildren()).toHaveLength(0);
  });
});

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
  // The feed flags come from /api/feed-config (#836), never from the page module.
  it('does not read the home feed flags', () => {
    const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toMatch(/HOME_FEED/);
  });
});
