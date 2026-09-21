import { fireEvent, render, screen } from '@testing-library/react';
import EmptyState, { EmptyStateCard } from './EmptyState';

describe('EmptyState', () => {
  /** AC: copy must distinguish "we found nothing" from "we could not look". */
  it('tells a genuine empty result apart from a failed fetch', () => {
    render(<EmptyState variant="search" />);
    expect(screen.getByText('No results found')).toBeInTheDocument();

    render(<EmptyState variant="error" />);
    expect(screen.getByText('Could not load homes')).toBeInTheDocument();
  });

  it('never promises inventory it cannot confirm', () => {
    render(<EmptyState variant="generic" />);
    expect(screen.queryByText(/check back later/i)).not.toBeInTheDocument();
  });

  it('offers a retry action for a failed load, and calls it on click', () => {
    const onRetry = jest.fn();
    render(<EmptyState variant="error" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not offer retry for a genuine empty result', () => {
    render(<EmptyState variant="search" />);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('EmptyStateCard', () => {
  it('renders a distinguishable failure with a retry affordance, not a blank card', () => {
    const onRetry = jest.fn();
    render(<EmptyStateCard variant="failed" onRetry={onRetry} />);

    expect(screen.getByText('Failed to load')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tap to retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
