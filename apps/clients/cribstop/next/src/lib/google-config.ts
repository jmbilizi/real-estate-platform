/** The committed secret placeholder. It means "not configured". */
const PLACEHOLDER = 'StrongBase64Password';

/** The usable Google client ID, or `null` for an unset, empty or placeholder value. */
export function googleClientId(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value && value !== PLACEHOLDER ? value : null;
}
