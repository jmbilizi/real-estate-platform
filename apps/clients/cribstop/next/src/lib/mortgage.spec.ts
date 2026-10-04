import {
  downPaymentAmount,
  monthlyHoa,
  monthlyPrincipalAndInterest,
  monthlyTax,
  parseNumberInput,
} from '@/lib/mortgage';

describe('parseNumberInput', () => {
  it.each([
    ['500000', 500000],
    ['$500,000', 500000],
    ['6.5', 6.5],
    ['6.5%', 6.5],
    ['.5', 0.5],
    ['0', 0],
  ])('parses %s', (raw, expected) => {
    expect(parseNumberInput(raw)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '1e3', '-5', '1.2.3', '.', 'Infinity'])('rejects %j', (raw) => {
    expect(parseNumberInput(raw)).toBeNull();
  });
});

describe('monthlyPrincipalAndInterest', () => {
  it('matches the standard amortization figure', () => {
    // $400,000 at 6% over 30 years is $2,398.20 a month.
    expect(monthlyPrincipalAndInterest(400000, 6, 30)).toBeCloseTo(2398.2, 1);
  });

  it('divides the loan evenly at 0% interest', () => {
    expect(monthlyPrincipalAndInterest(360000, 0, 30)).toBe(1000);
  });

  it('returns null for a zero or negative loan, a bad rate, or a bad term', () => {
    expect(monthlyPrincipalAndInterest(0, 6, 30)).toBeNull();
    expect(monthlyPrincipalAndInterest(-1, 6, 30)).toBeNull();
    expect(monthlyPrincipalAndInterest(100000, -1, 30)).toBeNull();
    expect(monthlyPrincipalAndInterest(100000, 31, 30)).toBeNull();
    expect(monthlyPrincipalAndInterest(100000, NaN, 30)).toBeNull();
    expect(monthlyPrincipalAndInterest(100000, 6, 0)).toBeNull();
  });
});

describe('monthlyHoa', () => {
  it.each([
    ['Monthly', 100, 100],
    ['Annually', 1200, 100],
    ['Quarterly', 300, 100],
    ['Semi-Annually', 600, 100],
    ['Weekly', 12, 52],
    ['Bi-Weekly', 12, 26],
    [' monthly ', 100, 100],
  ])('normalizes %s', (frequency, fee, expected) => {
    expect(monthlyHoa(fee, frequency)).toBeCloseTo(expected, 5);
  });

  it('omits unknown, one-time, missing, and zero values', () => {
    expect(monthlyHoa(500, 'One Time')).toBeNull();
    expect(monthlyHoa(500, 'Other')).toBeNull();
    expect(monthlyHoa(500, null)).toBeNull();
    expect(monthlyHoa(null, 'Monthly')).toBeNull();
    expect(monthlyHoa(0, 'Monthly')).toBeNull();
  });
});

describe('monthlyTax', () => {
  it('divides the annual amount by 12', () => {
    expect(monthlyTax(6000)).toBe(500);
  });

  it('omits missing and zero amounts', () => {
    expect(monthlyTax(null)).toBeNull();
    expect(monthlyTax(0)).toBeNull();
  });
});

describe('downPaymentAmount', () => {
  it('computes from a percent', () => {
    expect(downPaymentAmount(500000, 'percent', 20)).toBe(100000);
  });

  it('uses an amount as given', () => {
    expect(downPaymentAmount(500000, 'amount', 75000)).toBe(75000);
  });

  it('rejects blank, negative, and above-price values', () => {
    expect(downPaymentAmount(500000, 'percent', null)).toBeNull();
    expect(downPaymentAmount(500000, 'percent', -1)).toBeNull();
    expect(downPaymentAmount(500000, 'percent', 101)).toBeNull();
    expect(downPaymentAmount(500000, 'amount', 500001)).toBeNull();
  });
});
