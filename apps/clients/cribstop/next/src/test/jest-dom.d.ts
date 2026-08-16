/**
 * Pulls `@testing-library/jest-dom`'s matcher augmentation into the program that
 * `pnpm exec nx type-check cribstop-next` compiles.
 *
 * Jest itself never needed this — `jest.setup.ts` imports the package at runtime and
 * `tsconfig.spec.json` compiles the specs — but the `type-check` target runs `tsc` against
 * `tsconfig.json`, whose `include` covers `src/**` (so the specs are in the program) while
 * `jest.setup.ts` is not. Without this reference every `toBeInTheDocument()` in every spec is a
 * type error in a target that is otherwise green, which is exactly the kind of noise that trains
 * people to stop reading type-check output.
 */
/// <reference types="@testing-library/jest-dom" />
