/**
 * Types the value that `global-setup.ts` stashes on `globalThis` for
 * `global-teardown.ts` to read. The Nx generator's scaffold declared this as a
 * module-scoped `var`, which does not actually widen `globalThis` — leaving
 * `globalThis.__TEARDOWN_MESSAGE__` as a TS7017 error under this repo's
 * stricter compiler settings.
 */
declare global {
  // eslint-disable-next-line no-var
  var __TEARDOWN_MESSAGE__: string;
}

export {};
