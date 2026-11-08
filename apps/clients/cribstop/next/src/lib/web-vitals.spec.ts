import { analyticsEventBatchSchema } from '@cribstop/property-contracts';
import { flushEvents } from './analytics';
import { getAnonId } from './anon-id';
import { setPersonalisation } from './feed-profile';
import { reportWebVital } from './web-vitals';

function setGpc(value: boolean | undefined) {
  Object.defineProperty(window.navigator, 'globalPrivacyControl', { value, configurable: true });
}

describe('reportWebVital (#987)', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    window.localStorage.clear();
    setGpc(undefined);
  });

  const sent = (): Record<string, unknown>[] => {
    flushEvents();
    return fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(init.body));
  };

  it('sends a contract-valid event with the route template, device and anon id', () => {
    reportWebVital({ name: 'LCP', value: 2314.6, rating: 'good' }, '/listing/abc-123');
    const events = sent();
    expect(analyticsEventBatchSchema.safeParse(events).success).toBe(true);
    const vital = events.find((e) => e['event'] === 'web_vital');
    expect(vital).toMatchObject({
      surface: 'detail',
      path_template: '/listing/[id]',
      device: 'desktop',
      metric: 'LCP',
      value: 2315,
      rating: 'good',
    });
    expect(vital?.['anon_id']).toBe(getAnonId());
  });

  it('keeps CLS as a score and sends no URL, listing id or query string', () => {
    reportWebVital({ name: 'CLS', value: 0.123456, rating: 'needs-improvement' }, '/listing/x');
    const vital = sent().find((e) => e['event'] === 'web_vital');
    expect(vital?.['value']).toBe(0.1235);
    expect(vital).not.toHaveProperty('listing_id');
    expect(JSON.stringify(vital)).not.toMatch(/"\/listing\/x"|location|href|\?/);
  });

  it('ignores a metric that is not LCP, INP or CLS', () => {
    reportWebVital({ name: 'FCP', value: 900, rating: 'good' }, '/');
    reportWebVital({ name: 'TTFB', value: 90, rating: 'good' }, '/');
    expect(sent()).toEqual([]);
  });

  it('ignores a bad value or rating', () => {
    reportWebVital({ name: 'INP', value: Number.NaN, rating: 'good' }, '/');
    reportWebVital({ name: 'INP', value: -1, rating: 'good' }, '/');
    reportWebVital({ name: 'INP', value: 100, rating: 'great' }, '/');
    expect(sent()).toEqual([]);
  });

  it('sends nothing after an opt-out', () => {
    getAnonId();
    setPersonalisation(false);
    reportWebVital({ name: 'LCP', value: 1000, rating: 'good' }, '/');
    expect(sent()).toEqual([]);
  });

  it('sends nothing under Global Privacy Control', () => {
    getAnonId();
    setGpc(true);
    reportWebVital({ name: 'LCP', value: 1000, rating: 'good' }, '/');
    expect(sent()).toEqual([]);
  });
});
