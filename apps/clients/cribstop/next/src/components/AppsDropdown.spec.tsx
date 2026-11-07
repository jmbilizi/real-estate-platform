import { fireEvent, render, screen } from '@testing-library/react';
import AppsDropdown from './AppsDropdown';

describe('AppsDropdown', () => {
  it('lists the shipped apps and no Alerts entry', () => {
    render(<AppsDropdown />);
    fireEvent.click(screen.getByRole('button', { name: 'Site apps' }));
    expect(screen.getByRole('link', { name: 'Homes' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Messages' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Alerts' })).not.toBeInTheDocument();
    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('href', '/alerts');
    }
  });
});
