import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// #449. The 1000 ms default fails `findBy*`/`waitFor` on a loaded CI runner.
configure({ asyncUtilTimeout: 5000 });

/**
 * `next/navigation` has no router context outside the App Router runtime. Tests that assert
 * on rendering, not on navigation, would otherwise fail on the hook rather than the assertion.
 */
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  redirect: jest.fn(),
}));

jest.mock('next/link', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ href, children, ...rest }: Record<string, unknown> & { href: string }) =>
      React.createElement('a', { href, ...rest }, children as React.ReactNode),
  };
});
