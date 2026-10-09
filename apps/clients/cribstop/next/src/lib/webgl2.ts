let cached: boolean | null = null;

/** True when the browser creates a WebGL2 context. The result is cached for the page. */
export function supportsWebGL2(): boolean {
  if (cached !== null) return cached;
  try {
    cached = Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    cached = false;
  }
  return cached;
}

export function resetWebGL2CacheForTests(): void {
  cached = null;
}
