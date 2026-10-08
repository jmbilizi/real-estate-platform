import { render, screen } from '@testing-library/react';
import { BRAND } from '@/lib/brand';
import fairHousingContent from '@/content/legal/fair-housing.json';
import FairHousingPage, { metadata } from './page';

describe('FairHousingPage', () => {
  it('renders the page title and one h1', () => {
    render(<FairHousingPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Fair Housing');
  });

  it('is published: indexable, no draft marker, no pending text', () => {
    const { container } = render(<FairHousingPage />);

    expect(fairHousingContent.isDraft).toBe(false);
    expect(metadata.robots).toBeUndefined();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/pending|draft|placeholder/i);
  });

  it('shows a real effective date', () => {
    render(<FairHousingPage />);

    expect(screen.getByText(/Effective date: [A-Z][a-z]+ \d{1,2}, \d{4}/)).toBeInTheDocument();
  });

  it('carries Real Broker, LLC brand prominence and the Equal Housing Opportunity line (PRD §6.1)', () => {
    render(<FairHousingPage />);

    expect(screen.getByText(new RegExp(`Brokered by ${BRAND.brokerageShort}`))).toBeInTheDocument();
    expect(screen.getAllByText(/Equal Housing Opportunity/).length).toBeGreaterThan(0);
  });
});
