import { render, screen } from '@testing-library/react';
import PasswordRequirements from './PasswordRequirements';
import { DEFAULT_PASSWORD_POLICY } from '@/lib/password-rules';

const renderFor = (password: string) =>
  render(<PasswordRequirements id="rules" password={password} policy={DEFAULT_PASSWORD_POLICY} />);

const met = () =>
  screen
    .getAllByRole('listitem')
    .filter((li) => li.dataset.met === 'true')
    .map((li) => li.textContent?.replace(': met', ''));

describe('PasswordRequirements', () => {
  it('always renders the five rows and the passphrase line', () => {
    renderFor('');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('Or use 15+ characters, no other rules.')).toBeInTheDocument();
    expect(met()).toEqual([]);
  });

  it('ticks rules as the password meets them', () => {
    renderFor('Abcdefg1');
    expect(met()).toEqual([
      '8+ characters',
      'An uppercase letter',
      'A lowercase letter',
      'A number',
    ]);
  });

  it('shows every rule as met at 15 characters', () => {
    renderFor('a'.repeat(15));
    expect(met()).toHaveLength(5);
  });
});
