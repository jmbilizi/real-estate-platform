/** @jest-environment node */
import * as page from './page';

jest.mock('@/components/ScrollSentinel', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/HomePageContent', () => ({ __esModule: true, default: () => null }));

describe('home page module', () => {
  it('stays static: no force-dynamic (#836, the #755 outage was home-page load)', () => {
    expect((page as Record<string, unknown>).dynamic).toBeUndefined();
  });
});
