/**
 * Reads a US phone number (NANP) and returns it as `+1XXXXXXXXXX`, or `null` when it is not one.
 * Accepts 10 digits, or 11 digits with a leading country code 1. Ignores spaces, dashes,
 * dots and parentheses. The area code and the exchange cannot start with 0 or 1.
 */
export function normalizeUsPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}
