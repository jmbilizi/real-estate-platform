jest.mock('@/components/HomePageContent', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ScrollSentinel', () => ({ __esModule: true, default: () => null }));

import { generateMetadata } from './page';

describe('home page metadata', () => {
  const saved = process.env.SITE_ORIGIN;
  afterEach(() => {
    if (saved === undefined) delete process.env.SITE_ORIGIN;
    else process.env.SITE_ORIGIN = saved;
  });

  it('has title, description, canonical and Open Graph', () => {
    process.env.SITE_ORIGIN = 'https://example.com/';
    const meta = generateMetadata();

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

    expect(generateMetadata().alternates).toBeUndefined();
  });
});
