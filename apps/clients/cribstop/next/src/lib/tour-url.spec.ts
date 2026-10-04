import { resolveTourEntry } from './tour-url';

describe('resolveTourEntry', () => {
  it('frames an allowlisted https host', () => {
    expect(resolveTourEntry('https://my.matterport.com/show/?m=abc')).toEqual({
      href: 'https://my.matterport.com/show/?m=abc',
      mode: 'frame',
    });
  });

  it('matches the host case-insensitively', () => {
    expect(resolveTourEntry('https://MY.Matterport.com/show/?m=abc')?.mode).toBe('frame');
  });

  it('opens an unknown https host in a new tab', () => {
    expect(resolveTourEntry('https://tours.example.com/t/1')?.mode).toBe('tab');
  });

  it.each([
    'http://my.matterport.com/show/?m=abc',
    'javascript:alert(1)',
    'data:text/html,<p>x</p>',
    'ftp://my.matterport.com/x',
    'https://user:pw@my.matterport.com/show',
    'not a url',
    '',
  ])('rejects %s', (raw) => {
    expect(resolveTourEntry(raw)).toBeNull();
  });

  it('does not frame lookalike hosts', () => {
    expect(resolveTourEntry('https://my.matterport.com.evil.test/x')?.mode).toBe('tab');
    expect(resolveTourEntry('https://evil.test/my.matterport.com')?.mode).toBe('tab');
    expect(resolveTourEntry('https://matterport.com/x')?.mode).toBe('tab');
  });

  it('returns null for null and undefined', () => {
    expect(resolveTourEntry(null)).toBeNull();
    expect(resolveTourEntry(undefined)).toBeNull();
  });
});
