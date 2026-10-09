import { render, screen } from '@testing-library/react';
import { BRAND } from '@/lib/brand';
import privacyContent from '@/content/legal/privacy.json';
import PrivacyPage, { metadata } from './page';

describe('PrivacyPage', () => {
  it('renders the page title and one h1', () => {
    render(<PrivacyPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy Policy');
  });

  it('is published: indexable, no draft marker, no pending text', () => {
    const { container } = render(<PrivacyPage />);

    expect(privacyContent.isDraft).toBe(false);
    expect(metadata.robots).toBeUndefined();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/pending|draft|placeholder/i);
  });

  it('shows a real effective date', () => {
    render(<PrivacyPage />);

    expect(screen.getByText(/Effective date: [A-Z][a-z]+ \d{1,2}, \d{4}/)).toBeInTheDocument();
  });

  it('carries Real Broker, LLC brand prominence and the Equal Housing Opportunity line (PRD §6.1)', () => {
    render(<PrivacyPage />);

    expect(screen.getByText(new RegExp(`Brokered by ${BRAND.brokerageShort}`))).toBeInTheDocument();
    expect(screen.getAllByText(/Equal Housing Opportunity/).length).toBeGreaterThan(0);
  });
});
