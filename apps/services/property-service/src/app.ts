import express, { Express } from 'express';

/**
 * Builds the Express app without starting the HTTP listener, so tests can
 * exercise routes via supertest without opening a real socket or requiring
 * a live database connection.
 *
 * No public REST API beyond `/health` ships in this ticket — search/detail
 * endpoints are a separate ticket (#22).
 */
export function createApp(): Express {
  const app = express();

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
