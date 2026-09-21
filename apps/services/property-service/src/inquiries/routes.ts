import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  type ErrorBody,
  idSchema,
  listingInquiryRequestSchema,
  NOT_FOUND_BODY,
  RATE_LIMITED_BODY,
} from '@cribstop/property-contracts';
import { isListingPublishable, type ReadClient } from '../listings/repository';
import { createListingInquiry, type Queryable } from './write';
import type { IntrospectionClient } from './account-introspection';
import type { RateLimiter } from './rate-limit';

/**
 * `POST /listings/:id/inquiries` (#131) — a consumer's message or tour request against a listing.
 *
 * Never returned by any read endpoint: this router adds no GET. `id` is validated and the listing
 * is checked against `listing_search_v` — the same single source of listing visibility every other
 * route in this service reads — before anything is written, so an unknown, soft-deleted or
 * `internet_display_allowed = false` listing is rejected exactly like `GET /listings/{id}` rejects
 * it: the one frozen 404 body, byte-identical.
 */

const invalidRequest = (message: string): ErrorBody => ({
  error: { code: 'invalid_request', message },
});

/** Mirrors `listings/routes.ts`'s `asyncRoute` — Express 4 does not await handlers. */
const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

/** A field name safe to reflect. Same reasoning as `listings/routes.ts`'s `safeParameterName` —
 *  an unrecognised-key name is caller-controlled, so it is filtered rather than echoed raw. */
function safeFieldName(name: string): string {
  const trimmed = name.slice(0, 40);
  return /^[A-Za-z0-9_.-]+$/.test(trimmed) ? trimmed : '(unnamed)';
}

/** Structural, so this file needs no direct `zod` import — `parsedBody.error.issues` already has
 *  this shape. */
interface IssueLike {
  code: string;
  path: readonly PropertyKey[];
  keys?: readonly string[];
}

function describeIssues(issues: readonly IssueLike[]): string {
  const unknownFields = new Set<string>();
  const invalidFields = new Set<string>();

  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys ?? []) {
        unknownFields.add(safeFieldName(key));
      }
      continue;
    }
    invalidFields.add(issue.path.length > 0 ? safeFieldName(String(issue.path[0])) : '(request)');
  }

  const sentences: string[] = [];
  if (unknownFields.size > 0) {
    sentences.push(`Unknown field(s): ${[...unknownFields].join(', ')}.`);
  }
  if (invalidFields.size > 0) {
    sentences.push(`Invalid value for field(s): ${[...invalidFields].join(', ')}.`);
  }
  return sentences.join(' ');
}

/** `X-Real-IP`, which the gateway guarantees is set before forwarding (see
 *  `apps/api-gateway/Startup.cs`). Falls back to the socket address for direct/local calls. */
function extractClientIp(req: Request): string {
  const header = req.headers['x-real-ip'];
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export interface InquiriesRouterDeps {
  pool: ReadClient & Queryable;
  introspection: IntrospectionClient;
  rateLimiter: RateLimiter;
}

export function createInquiriesRouter(deps: InquiriesRouterDeps): Router {
  const router = Router();

  router.post(
    '/listings/:id/inquiries',
    asyncRoute(async (req: Request, res: Response) => {
      const rawListingId = req.params.id ?? '';
      const clientIp = extractClientIp(req);

      // Rate-limited before anything else touches the database, keyed on the RAW path segment —
      // so a probe against a malformed or nonexistent id is still throttled per client, and a
      // real listing's per-listing limit is never consumed by a request that never named it.
      const decision = deps.rateLimiter.consume(clientIp, rawListingId);
      if (!decision.allowed) {
        res
          .set('Retry-After', String(decision.retryAfterSeconds))
          .status(429)
          .json(RATE_LIMITED_BODY);
        return;
      }

      const parsedId = idSchema.safeParse(rawListingId);
      if (!parsedId.success) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      const listingId = parsedId.data;

      const parsedBody = listingInquiryRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json(invalidRequest(describeIssues(parsedBody.error.issues)));
        return;
      }

      const publishable = await isListingPublishable(deps.pool, listingId);
      if (!publishable) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }

      // Resolved AFTER the listing check: there is no reason to call account-service for a
      // request that is about to 404 anyway.
      const accountId = await deps.introspection.resolveAccountId({
        cookie: req.headers.cookie,
        authorization: req.headers.authorization,
        apiKey: req.headers['x-api-key'] as string | undefined,
      });

      const createdId = await createListingInquiry(deps.pool, {
        listingId,
        kind: parsedBody.data.kind,
        name: parsedBody.data.name,
        email: parsedBody.data.email,
        phone: parsedBody.data.phone ?? null,
        message: parsedBody.data.message ?? null,
        accountId,
        consentToContact: parsedBody.data.consentToContact,
      });

      res.status(201).json({ id: createdId });
    }),
  );

  return router;
}
