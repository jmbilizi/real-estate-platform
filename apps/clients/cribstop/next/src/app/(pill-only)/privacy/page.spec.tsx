import { render, screen } from '@testing-library/react';
import { BRAND } from '@/lib/brand';
import privacyContent from '@/content/legal/privacy.json';
import PrivacyPage from './page';

describe('PrivacyPage', () => {
  it('renders the page title and one h1', () => {
    render(<PrivacyPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy Policy');
  });

  it('shows a visible draft marker while the content module is a draft (#156 gate)', () => {
    // Asserts against the module's actual state rather than hardcoding `true`, so this test
    // starts failing the day #156 ships approved copy — the signal to remove the assumption.
    expect(privacyContent.isDraft).toBe(true);

    render(<PrivacyPage />);

    expect(screen.getByRole('status')).toHaveTextContent(/draft/i);
  });

  it('shows the effective date from the content module', () => {
    render(<PrivacyPage />);

    expect(screen.getByText(/Effective date:/)).toBeInTheDocument();
  });

  it('carries Real Broker, LLC brand prominence and the Equal Housing Opportunity line (PRD §6.1)', () => {
    render(<PrivacyPage />);

    expect(screen.getByText(new RegExp(`Brokered by ${BRAND.brokerageShort}`))).toBeInTheDocument();
    expect(screen.getByText(/Equal Housing Opportunity/)).toBeInTheDocument();
  });
});
