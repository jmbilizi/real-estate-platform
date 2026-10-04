import { fireEvent, render, screen } from '@testing-library/react';
import MortgageTeaser from './MortgageTeaser';

const total = () => screen.queryByTestId('mortgage-total')?.textContent ?? null;

describe('MortgageTeaser', () => {
  it('shows P&I for the example inputs and labels the rate as an example', () => {
    render(<MortgageTeaser price={500000} />);
    // $400,000 at 6.5% over 30 years: $2,528 a month.
    expect(total()).toContain('$2,528');
    expect(screen.getByText(/6\.5% is an example, not a current rate/)).toBeTruthy();
    expect(screen.getByText(/estimate only/i)).toBeTruthy();
    expect(screen.queryByText('Property tax')).toBeNull();
    expect(screen.queryByText('HOA fee')).toBeNull();
  });

  it('adds tax and HOA to the total only when the data exists', () => {
    render(
      <MortgageTeaser
        price={500000}
        taxAnnualAmount={6000}
        hoaFee={1200}
        hoaFeeFrequency="Annually"
      />,
    );
    expect(screen.getByText('Property tax').nextSibling?.textContent).toBe('$500');
    expect(screen.getByText('HOA fee').nextSibling?.textContent).toBe('$100');
    // 2,528.27 + 500 + 100
    expect(total()).toContain('$3,128');
  });

  it('omits HOA when the frequency is unknown', () => {
    render(<MortgageTeaser price={500000} hoaFee={300} hoaFeeFrequency="One Time" />);
    expect(screen.queryByText('HOA fee')).toBeNull();
  });

  it('recomputes when the rate and term change', () => {
    render(<MortgageTeaser price={500000} />);
    fireEvent.change(screen.getByLabelText('Interest rate (%)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '20-yr' }));
    // $400,000 / 240 months
    expect(total()).toContain('$1,667');
  });

  it('accepts a dollar down payment', () => {
    render(<MortgageTeaser price={500000} />);
    fireEvent.click(screen.getByRole('button', { name: '$' }));
    fireEvent.change(screen.getByLabelText('Down payment'), { target: { value: '100000' } });
    expect(total()).toContain('$2,528');
  });

  it.each(['', 'abc', '-3', '101'])('shows no figure and no NaN for a bad percent %j', (value) => {
    const { container } = render(<MortgageTeaser price={500000} />);
    fireEvent.change(screen.getByLabelText('Down payment'), { target: { value } });
    expect(total()).toBeNull();
    expect(screen.getByTestId('mortgage-hint')).toBeTruthy();
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('shows no figure for a bad rate', () => {
    const { container } = render(<MortgageTeaser price={500000} />);
    fireEvent.change(screen.getByLabelText('Interest rate (%)'), { target: { value: 'x' } });
    expect(total()).toBeNull();
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('shows no zero payment when the down payment covers the price', () => {
    render(<MortgageTeaser price={500000} />);
    fireEvent.change(screen.getByLabelText('Down payment'), { target: { value: '100' } });
    expect(total()).toBeNull();
    expect(screen.getByTestId('mortgage-hint').textContent).toMatch(/no loan payment/);
  });

  it('renders nothing for a zero price', () => {
    const { container } = render(<MortgageTeaser price={0} />);
    expect(container.textContent).toBe('');
  });

  it('uses 16px text and decimal keyboards on the inputs', () => {
    render(<MortgageTeaser price={500000} />);
    for (const label of ['Down payment', 'Interest rate (%)']) {
      const input = screen.getByLabelText(label);
      expect(input.getAttribute('inputmode')).toBe('decimal');
      expect(input.className).toContain('text-base');
      expect(input.className).toContain('min-h-11');
    }
  });
});
