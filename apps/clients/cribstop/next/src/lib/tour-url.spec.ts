import tourHosts from './tour-hosts.json';
import { resolveTourEntry } from './tour-url';

describe('resolveTourEntry', () => {
  it('frames an allowlisted https host', () => {
    expect(resolveTourEntry('https://my.matterport.com/show/?m=abc')).toEqual({
      href: 'https://my.matterport.com/show/?m=abc',
      mode: 'frame',
      embedSrc: 'https://my.matterport.com/show/?m=abc',
    });
  });

  it('matches the host case-insensitively', () => {
    expect(resolveTourEntry('https://MY.Matterport.com/show/?m=abc')?.mode).toBe('frame');
  });

  it('opens an unknown https host in a new tab and gives it no embed URL', () => {
    expect(resolveTourEntry('https://tours.example.com/t/1')).toEqual({
      href: 'https://tours.example.com/t/1',
      mode: 'tab',
      embedSrc: null,
    });
  });

  it('keeps a host that forbids framing in a new tab', () => {
    expect(resolveTourEntry('https://canva.link/pnhwo5lr9p0z11g')?.mode).toBe('tab');
    expect(resolveTourEntry('https://www.canva.com/design/x/y/watch')?.mode).toBe('tab');
  });

  it.each([
    'http://my.matterport.com/show/?m=abc',
    'javascript:alert(1)',
    'data:text/html,<p>x</p>',
    'ftp://my.matterport.com/x',
    'https://user:pw@my.matterport.com/show',
    'https://user@my.matterport.com/show',
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

  it('opens a custom port in a new tab, because the CSP source has no port', () => {
    expect(resolveTourEntry('https://my.matterport.com:8443/x')?.mode).toBe('tab');
  });

  it('returns null for null and undefined', () => {
    expect(resolveTourEntry(null)).toBeNull();
    expect(resolveTourEntry(undefined)).toBeNull();
  });

  it('frames Zillow only on its tour path', () => {
    expect(resolveTourEntry('https://www.zillow.com/view-imx/321f9912-7cd4?wl=true')?.mode).toBe(
      'frame',
    );
    expect(resolveTourEntry('https://www.zillow.com/homedetails/1-Main-St/123_zpid/')?.mode).toBe(
      'tab',
    );
  });

  describe('wildcard hosts', () => {
    it('frames any subdomain of a listed `*.` host', () => {
      expect(
        resolveTourEntry('https://atlanticexposurellc.hd.pics/36442-Carriage-Walk-Ln/idx')?.mode,
      ).toBe('frame');
      expect(resolveTourEntry('https://a.b.vids.io/videos/x')?.mode).toBe('frame');
    });

    it('does not frame the bare domain or a lookalike', () => {
      expect(resolveTourEntry('https://hd.pics/x')?.mode).toBe('tab');
      expect(resolveTourEntry('https://evilhd.pics/x')?.mode).toBe('tab');
      expect(resolveTourEntry('https://x.hd.pics.evil.test/x')?.mode).toBe('tab');
    });
  });

  describe('embed rewrites', () => {
    it.each([
      [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      ],
      [
        'https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s',
        'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      ],
      [
        'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      ],
      ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
      [
        'https://www.youtube.com/embed/dQw4w9WgXcQ',
        'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      ],
      [
        'https://www.youtube.com/shorts/dQw4w9WgXcQ',
        'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      ],
      ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
      [
        'https://vimeo.com/76979871/abcdef1234',
        'https://player.vimeo.com/video/76979871?h=abcdef1234',
      ],
      [
        'https://player.vimeo.com/video/76979871?h=abcdef1234&x=1',
        'https://player.vimeo.com/video/76979871?h=abcdef1234',
      ],
      [
        'https://matterport.com/discover/space/dEjFcnXqd1k',
        'https://my.matterport.com/show/?m=dEjFcnXqd1k',
      ],
      [
        'https://discover.matterport.com/space/dEjFcnXqd1k',
        'https://my.matterport.com/show/?m=dEjFcnXqd1k',
      ],
    ])('plays %s as %s', (page, embed) => {
      expect(resolveTourEntry(page)).toEqual({ href: page, mode: 'frame', embedSrc: embed });
    });

    it.each([
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ%22onload%3Dalert(1)',
      'https://www.youtube.com/@channel',
      'https://www.youtube.com/playlist?list=PL1',
      'https://youtu.be/',
      'https://vimeo.com/channels/staffpicks',
      'https://vimeo.com/user123',
      'https://matterport.com/discover/space/too-short',
      'https://matterport.com/discover',
      'https://discover.matterport.com/space/a/b',
    ])('opens %s in a new tab, because it has no embed form', (page) => {
      const entry = resolveTourEntry(page);
      expect(entry?.mode).toBe('tab');
      expect(entry?.embedSrc).toBeNull();
    });

    it('does not rewrite a lookalike host', () => {
      expect(resolveTourEntry('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ')?.mode).toBe(
        'tab',
      );
      expect(resolveTourEntry('https://evil.test/youtu.be/dQw4w9WgXcQ')?.mode).toBe('tab');
    });

    it('rejects an embed form with credentials or a non-https scheme before it rewrites', () => {
      expect(resolveTourEntry('http://youtu.be/dQw4w9WgXcQ')).toBeNull();
      expect(resolveTourEntry('https://u:p@youtu.be/dQw4w9WgXcQ')).toBeNull();
    });
  });

  describe('tour-hosts.json', () => {
    it('lists bare hostnames or `*.` wildcards, with no scheme, port or path', () => {
      for (const host of tourHosts.frameHosts) {
        expect(host).toMatch(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/);
      }
    });

    it('lists the hosts the embed rewrites produce', () => {
      expect(tourHosts.frameHosts).toEqual(
        expect.arrayContaining([
          'www.youtube-nocookie.com',
          'player.vimeo.com',
          'my.matterport.com',
        ]),
      );
    });
  });
});
