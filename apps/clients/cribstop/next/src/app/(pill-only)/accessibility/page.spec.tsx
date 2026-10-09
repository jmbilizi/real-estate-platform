import { render, screen } from '@testing-library/react';
import { BRAND } from '@/lib/brand';
import accessibilityContent from '@/content/legal/accessibility.json';
import AccessibilityPage, { metadata } from './page';

describe('AccessibilityPage', () => {
  it('renders the page title and one h1', () => {
    render(<AccessibilityPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Accessibility');
  });

  it('is published: indexable, no draft marker, no pending text', () => {
    const { container } = render(<AccessibilityPage />);

    expect(accessibilityContent.isDraft).toBe(false);
    expect(metadata.robots).toBeUndefined();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/pending|draft|placeholder/i);
  });

  it('shows a real effective date', () => {
    render(<AccessibilityPage />);

    expect(screen.getByText(/Effective date: [A-Z][a-z]+ \d{1,2}, \d{4}/)).toBeInTheDocument();
  });

  it('carries Real Broker, LLC brand prominence and the Equal Housing Opportunity line (PRD §6.1)', () => {
    render(<AccessibilityPage />);

    expect(screen.getByText(new RegExp(`Brokered by ${BRAND.brokerageShort}`))).toBeInTheDocument();
    expect(screen.getAllByText(/Equal Housing Opportunity/).length).toBeGreaterThan(0);
  });
});
