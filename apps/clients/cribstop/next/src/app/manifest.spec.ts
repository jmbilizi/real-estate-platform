import manifest from './manifest';

describe('web app manifest (#923)', () => {
  it('opens standalone and keeps the brokerage first in the name', () => {
    const m = manifest();
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    expect(m.name?.startsWith('Real Broker, LLC')).toBe(true);
  });
});
