import { fireEvent, render, screen } from '@testing-library/react';
import PersonaliseSwitch from './PersonaliseSwitch';
import { FEED_PROFILE_KEY, PERSONALISE_KEY, recordFeedItem } from '@/lib/feed-profile';

describe('PersonaliseSwitch', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: undefined,
      configurable: true,
    });
  });

  it('turns personalisation off and deletes the profile', () => {
    recordFeedItem('a', 'view');
    render(<PersonaliseSwitch />);
    fireEvent.click(screen.getByRole('switch', { name: /personalise my home page/i }));
    expect(window.localStorage.getItem(PERSONALISE_KEY)).toBe('off');
    expect(window.localStorage.getItem(FEED_PROFILE_KEY)).toBeNull();
  });

  it('clears browsing history', () => {
    recordFeedItem('a', 'view');
    render(<PersonaliseSwitch />);
    fireEvent.click(screen.getByRole('button', { name: /clear browsing history/i }));
    expect(window.localStorage.getItem(FEED_PROFILE_KEY)).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('locks the switch off under Global Privacy Control', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    render(<PersonaliseSwitch />);
    const sw = screen.getByRole('switch');
    expect(sw).toBeDisabled();
    expect(sw).not.toBeChecked();
  });
});
