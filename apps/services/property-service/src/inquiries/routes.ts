import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  type ErrorBody,
  idSchema,
  listingInquiryRequestSchema,
  NOT_FOUND_BODY,
  RATE_LIMITED_BODY,
  UNAUTHENTICATED_BODY,
  UNAVAILABLE_BODY,
} from '@cribstop/property-contracts';
import { isListingPublishable, type ReadClient } from '../listings/repository';
import { createListingInquiry, type Queryable } from './write';
import type { IntrospectionClient } from './account-introspection';
import { resolveRequester } from './requester';
import type { RateLimiter } from './rate-limit';

/**
 * `POST /listings/:id/inquiries` (#131) — a consumer's message or tour request against a listing.
 *
 * Needs a signed-in account with a confirmed email (#690). Rate limiting runs first, then sign-in,
 * then the listing check.
 *
 * No public read endpoint: this router adds no GET. Staff read endpoints sit behind roles (#632). `id` is validated and the listing
 * is checked against `listing_search_v` — the same single source of listing visibility every other
 * route in this service reads — before anything is written, so an unknown, soft-deleted or
 * `internet_display_allowed = false` listing is rejected exactly like `GET /listings/{id}` rejects
 * it: the one frozen 404 body, byte-identical.
 */

const UNCONFIRMED_ACCOUNT_BODY: ErrorBody = {
  error: {
    code: 'forbidden',
    message: 'Confirm your email address before you send a request.',
  },
};

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

/** `name` and `email` left the contract in #690. The strict schema would reject them, so a client
 *  built before the change is read as if it never sent them. The account supplies both. */
function withoutRetiredContactFields(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
  const { name: _name, email: _email, ...rest } = body as Record<string, unknown>;
  return rest;
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

/** A header Node may deliver as an array (a repeated header name) folds to its first value,
 *  never a comma-joined string — passing a garbled credential to account-service would silently
 *  fail introspection and fall back to signed-out instead of surfacing a caller error. */
function firstHeaderValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
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

      // Rate-limited before anything else touches the database, keyed on the path segment —
      // so a probe against a malformed or nonexistent id is still throttled per client, and a
      // real listing's per-listing limit is never consumed by a request that never named it.
      // Lower-cased: Postgres's `uuid` type compares case-insensitively, so a caller cycling
      // through hex-case permutations of the SAME id must not get a fresh counter each time.
      const decision = deps.rateLimiter.consume(clientIp, rawListingId.toLowerCase());
      if (!decision.allowed) {
        res
          .set('Retry-After', String(decision.retryAfterSeconds))
          .status(429)
          .json(RATE_LIMITED_BODY);
        return;
      }

      // Before the body and the listing are read, so an anonymous caller learns nothing about a
      // listing. An unconfirmed account gets a clear 403, not a 401 it cannot fix by signing in.
      const requester = await resolveRequester(deps.introspection, {
        cookie: req.headers.cookie,
        authorization: req.headers.authorization,
        apiKey: firstHeaderValue(req.headers['x-api-key']),
      });
      if (requester.kind === 'signed-out') {
        res.status(401).json(UNAUTHENTICATED_BODY);
        return;
      }
      if (requester.kind === 'unavailable') {
        res.set('Retry-After', '2').status(503).json(UNAVAILABLE_BODY);
        return;
      }
      if (requester.kind === 'unconfirmed') {
        res.status(403).json(UNCONFIRMED_ACCOUNT_BODY);
        return;
      }

      const parsedId = idSchema.safeParse(rawListingId);
      if (!parsedId.success) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      const listingId = parsedId.data;

      const parsedBody = listingInquiryRequestSchema.safeParse(withoutRetiredContactFields(req.body));
      if (!parsedBody.success) {
        res.status(400).json(invalidRequest(describeIssues(parsedBody.error.issues)));
        return;
      }

      const publishable = await isListingPublishable(deps.pool, listingId);
      if (!publishable) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }

      const createdId = await createListingInquiry(deps.pool, {
        listingId,
        kind: parsedBody.data.kind,
        contactEmail: requester.accountEmail,
        phone: parsedBody.data.phone ?? null,
        message: parsedBody.data.message ?? null,
        accountId: requester.accountId,
        consentToContact: parsedBody.data.consentToContact,
        consentTextVersion: parsedBody.data.consentTextVersion,
        consentChannels: parsedBody.data.consentChannels,
      });

      res.status(201).json({ id: createdId });
    }),
  );

  return router;
}
