import type { Express } from 'express';
import { toOpenApiDocument } from '@cribstop/property-contracts';
import { createApp } from './app';
import type { ReadPool } from './listings/repository';

/**
 * Guards #278: the published OpenAPI document and the Express routes must list the same
 * operations. The expected set comes from the live router, so a new route fails this test until it
 * is documented, and a documented path fails it until it is routed.
 */

/** Routes that are not part of the Property API contract. */
const UNDOCUMENTED = [/^\/health(\/|$)/, /^\/openapi\.json$/, /^\/admin\//];

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  regexp?: RegExp & { fast_slash?: boolean };
  handle?: { stack?: Layer[] };
}

function collectOperations(layers: Layer[], operations: Set<string>): void {
  for (const layer of layers) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        operations.add(`${method.toUpperCase()} ${layer.route.path}`);
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      // No router is mounted under a prefix today. Fail loudly if one appears.
      if (!layer.regexp?.fast_slash) {
        throw new Error('Router mounted under a prefix: extend collectOperations to join it.');
      }
      collectOperations(layer.handle.stack, operations);
    }
  }
}

const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

function routedOperations(): string[] {
  const app = createApp({
    pool: { query: async () => ({ rows: [] }) } as unknown as ReadPool,
  }) as Express & { _router: { stack: Layer[] } };
  const raw = new Set<string>();
  collectOperations(app._router.stack, raw);
  return [...raw]
    .map((operation) => {
      const [method = '', path = ''] = operation.split(' ');
      return { method, path: toOpenApiPath(path) };
    })
    .filter(({ path }) => !UNDOCUMENTED.some((pattern) => pattern.test(path)))
    .map(({ method, path }) => `${method} ${path}`);
}

function documentedOperations(): string[] {
  const document = toOpenApiDocument() as { paths: Record<string, Record<string, unknown>> };
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((key) => ['get', 'post', 'put', 'patch', 'delete'].includes(key))
      .map((method) => `${method.toUpperCase()} ${path}`),
  );
}

describe('OpenAPI document and Express routes', () => {
  const routed = routedOperations();
  const documented = documentedOperations();

  it('finds routes to compare', () => {
    expect(routed.length).toBeGreaterThan(0);
    expect(documented.length).toBeGreaterThan(0);
  });

  it('documents every routed operation', () => {
    expect(routed.filter((operation) => !documented.includes(operation)).sort()).toEqual([]);
  });

  it('routes every documented operation', () => {
    expect(documented.filter((operation) => !routed.includes(operation)).sort()).toEqual([]);
  });
});
