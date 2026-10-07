import { normalizeUsPhone } from './phone';

describe('normalizeUsPhone', () => {
  it.each([
    ['202-555-0100', '+12025550100'],
    ['(202) 555-0100', '+12025550100'],
    ['202.555.0100', '+12025550100'],
    ['1 202 555 0100', '+12025550100'],
    ['+1 (202) 555-0100', '+12025550100'],
    ['  2025550100 ', '+12025550100'],
  ])('keeps the digits and the country code of %s', (input, expected) => {
    expect(normalizeUsPhone(input)).toBe(expected);
  });

  it.each([
    '555-0100',
    '020-555-0100',
    '202-155-0100',
    '+44 20 7946 0958',
    '12025550100123',
    '202-555-01ab',
    '',
  ])('rejects %s', (input) => {
    expect(normalizeUsPhone(input)).toBeNull();
  });
});
