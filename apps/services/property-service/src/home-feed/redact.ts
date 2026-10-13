/**
 * The service has no request logger today. If one is added, or if a log call carries a request
 * body, pass the value through this function first. It removes `profile` at any depth.
 */
export const REDACTED = '[redacted]';

export function redactProfile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactProfile);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        key === 'profile' ? REDACTED : redactProfile(entry),
      ]),
    );
  }
  return value;
}
