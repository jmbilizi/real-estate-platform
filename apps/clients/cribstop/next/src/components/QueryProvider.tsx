'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query/query-client';

// A production build folds the condition to a constant, so the bundle omits Devtools.
const ReactQueryDevtools =
  process.env.NODE_ENV === 'development'
    ? dynamic(() => import('@tanstack/react-query-devtools').then((m) => m.ReactQueryDevtools), {
        ssr: false,
      })
    : () => null;

export default function QueryProvider({ children }: { children: ReactNode }) {
  // No `useState` here. A Suspense boundary above the provider would drop the client.
  const client = getQueryClient();
  return (
    <QueryClientProvider client={client}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
