/**
 * Copies text, and reports whether it worked.
 *
 * `navigator.clipboard` exists only in a secure context. On a plain-HTTP host that is not
 * `localhost` — a LAN device opening a dev server, an HTTP-only preview — the property is
 * `undefined` and reading `writeText` from it throws. Without a second path every click there
 * ends in an error the user cannot clear by retrying.
 *
 * `document.execCommand('copy')` is deprecated and still works in every browser we target. It is
 * the fallback rather than the default because it needs a live selection, which steals focus for
 * one frame.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyByExecCommand(text);
  }
}

function copyByExecCommand(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  // Off-screen rather than hidden: `display: none` and `visibility: hidden` are both unselectable,
  // and a selection is what `execCommand` copies.
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '-9999px';
  document.body.appendChild(field);

  try {
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(field);
  }
}
