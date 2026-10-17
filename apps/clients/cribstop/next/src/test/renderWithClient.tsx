import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';

/** A fresh client for each call. Never share one across tests: `gcTime: Infinity` keeps its cache. */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export function renderWithClient(
  ui: ReactElement,
  client: QueryClient = makeTestQueryClient(),
): RenderResult & { client: QueryClient } {
  const wrap = (node: ReactNode): ReactElement => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  const result = render(wrap(ui));
  return {
    ...result,
    client,
    rerender: (next: ReactNode) => result.rerender(wrap(next)),
  };
}
