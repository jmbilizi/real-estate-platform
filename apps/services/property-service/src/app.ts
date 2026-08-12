import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { INTERNAL_ERROR_BODY, toOpenApiDocument } from '@cribstop/property-contracts';
import { getPool } from './db/pool';
import { createListingsRouter } from './listings/routes';
import type { ReadPool } from './listings/repository';

/**
 * The published OpenAPI document, generated ONCE at module load from `@cribstop/property-contracts`.
 * It is a pure function of the schemas, so there is nothing to recompute per request.
 *
 * Generated, never hand-written. Express emits no OpenAPI of its own, and the tempting fix — an
 * `openapi.yaml` beside the routes — is a second source of truth that drifts from the request parser
 * silently. Deriving it from the same Zod schemas the routes validate against means the document
 * cannot describe a parameter the service does not accept, or omit one it does.
 */
const OPEN_API_DOCUMENT = toOpenApiDocument();

export interface CreateAppOptions {
  /**
   * Injected so tests can exercise every route against a fake, with no socket and no database.
   * Defaults to the real pool, and `getPool()` is called lazily — inside `createApp`, not at module
   * load — so importing this module never demands `DATABASE_URL`.
   */
  pool?: ReadPool;
}

/**
 * Builds the Express app without starting the HTTP listener, so tests can exercise routes via
 * supertest without opening a real socket.
 *
 * This service's HTTP surface is the **Property API** (`property-service` owns
 * Communities → Properties → Units → Listings). `listings` is the resource, hence the `/listings/*`
 * paths — a service name is not a resource name.
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const pool = options.pool ?? (getPool() as unknown as ReadPool);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  /**
   * The spec URL the gateway's `MMLib.SwaggerForOcelot` fetches — see the `SwaggerEndPoints` entry in
   * `apps/api-gateway/Configuration/Routes/property-service-routes.json`. Served on the service's own
   * port; it is not a consumer endpoint routed through the gateway.
   */
  app.get('/openapi.json', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300').status(200).json(OPEN_API_DOCUMENT);
  });

  app.use(createListingsRouter(pool));

  /**
   * The error boundary. Handlers forward rejections here via the `asyncRoute` wrapper in
   * `listings/routes.ts`, because Express 4 does not await handlers and an unforwarded rejection leaves
   * the request hanging until the client times out — which reads as a gateway 504 and sends whoever
   * debugs it to the wrong layer.
   *
   * The body is deliberately opaque. A `pg` error message can name tables, columns and constraint
   * text, and these are public unauthenticated endpoints; the detail belongs in the log, not the
   * response.
   */
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    console.error('Unhandled error while serving the Property API:', error);
    res.status(500).json(INTERNAL_ERROR_BODY);
  });

  return app;
}
