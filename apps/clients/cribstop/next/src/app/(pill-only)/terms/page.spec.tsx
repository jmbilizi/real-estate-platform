import { render, screen } from '@testing-library/react';
import { BRAND } from '@/lib/brand';
import termsContent from '@/content/legal/terms.json';
import TermsPage from './page';

describe('TermsPage', () => {
  it('renders the page title and one h1', () => {
    render(<TermsPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Terms of Service');
  });

  it('shows a visible draft marker while the content module is a draft (#156 gate)', () => {
    expect(termsContent.isDraft).toBe(true);

    render(<TermsPage />);

    expect(screen.getByRole('status')).toHaveTextContent(/draft/i);
  });

  it('shows the effective date from the content module', () => {
    render(<TermsPage />);

    expect(screen.getByText(/Effective date:/)).toBeInTheDocument();
  });

  it('carries Real Broker, LLC brand prominence and the Equal Housing Opportunity line (PRD §6.1)', () => {
    render(<TermsPage />);

    expect(screen.getByText(new RegExp(`Brokered by ${BRAND.brokerageShort}`))).toBeInTheDocument();
    expect(screen.getByText(/Equal Housing Opportunity/)).toBeInTheDocument();
  });
});
