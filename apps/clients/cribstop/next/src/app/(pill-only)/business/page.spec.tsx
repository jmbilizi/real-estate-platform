import { renderToStaticMarkup } from 'react-dom/server';
import BusinessPage from './page';

jest.mock('./ProviderWaitlistButton', () => ({
  __esModule: true,
  default: () => <button type="button">Join the provider waitlist</button>,
}));

describe('/business page copy', () => {
  const html = renderToStaticMarkup(<BusinessPage />);

  it('renders server-side with the waitlist button and no disabled stub', () => {
    expect(html).toContain('Join the provider waitlist');
    expect(html).not.toContain('Create a business profile');
    expect(html).not.toContain('disabled');
  });

  it('makes no claim the platform cannot back', () => {
    expect(html).not.toMatch(/vetted|trusted|verified|credentials|reviews|discovered/i);
  });

  it('says the directory is not open and promises no outcome', () => {
    expect(html).toContain('The directory is not open yet');
    expect(html).toContain('We make no promise about ranking, matches or response time');
  });
});
