import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  type ErrorBody,
  homeFeedRequestSchema,
  INTERNAL_ERROR_BODY,
} from '@cribstop/property-contracts';
import type { ReadPool } from '../listings/repository';
import { redactProfile } from './redact';
import { buildHomeFeed, type FeedDeps } from './service';

/** A name that is safe to echo: an unknown key is caller-controlled. */
function safeName(name: string): string {
  const trimmed = name.slice(0, 40);
  return /^[A-Za-z0-9_.-]+$/.test(trimmed) ? trimmed : '(unnamed)';
}

const invalidRequest = (message: string): ErrorBody => ({
  error: { code: 'invalid_request', message },
});

/**
 * `POST /home-feed` (#835). The body carries the visitor's profile. The handler never stores it,
 * never puts it in a log line, and answers `no-store`. A personalised answer must not enter a
 * shared cache.
 */
export function createHomeFeedRouter(pool: ReadPool, deps: FeedDeps = {}): Router {
  const router = Router();

  router.post('/home-feed', (req: Request, res: Response, _next: NextFunction) => {
    const parsed = homeFeedRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // Names only. A value could echo the profile back into a response or a log.
      const names = new Set(
        parsed.error.issues.flatMap((issue) =>
          issue.code === 'unrecognized_keys'
            ? issue.keys.map(safeName)
            : [safeName(String(issue.path[0] ?? '(request)'))],
        ),
      );
      res
        .status(400)
        .json(invalidRequest(`Invalid or unknown field(s): ${[...names].join(', ')}.`));
      return;
    }
    buildHomeFeed(pool, parsed.data, deps)
      .then((feed) => {
        res.set('Cache-Control', 'no-store').status(200).json(feed);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Home feed failed:', redactProfile({ message }));
        res.status(500).json(INTERNAL_ERROR_BODY);
      });
  });

  return router;
}
