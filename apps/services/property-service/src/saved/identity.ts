import type { Request } from 'express';
import type {
  CredentialHeaders,
  IntrospectionClient,
  IntrospectionOutcome,
} from '../inquiries/account-introspection';
import type { ReadClient } from '../listings/repository';
import { findSavedHomeIds } from './store';

/** A header Node may deliver as an array folds to its first value, never a comma-joined string. */
function firstHeaderValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function credentialsOf(req: Request): CredentialHeaders {
  return {
    cookie: req.headers.cookie,
    authorization: req.headers.authorization,
    apiKey: firstHeaderValue(req.headers['x-api-key']),
  };
}

/** An id that is not a UUID cannot be an account id. It would fail in the `uuid` column. */
function checked(outcome: IntrospectionOutcome): IntrospectionOutcome {
  return outcome.kind === 'account' && !ACCOUNT_ID_PATTERN.test(outcome.accountId)
    ? { kind: 'signed-out' }
    : outcome;
}

/**
 * Resolves the caller with account-service's introspection (#86), keeping an outage visible as
 * `unavailable`. The result is never cached: account-service re-checks the security stamp on every
 * request, so a revoked session must stop working at once.
 */
export async function authenticate(
  introspection: IntrospectionClient,
  req: Request,
): Promise<IntrospectionOutcome> {
  const headers = credentialsOf(req);
  if (introspection.introspect !== undefined) {
    return checked(await introspection.introspect(headers));
  }
  const accountId = await introspection.resolveAccountId(headers);
  return checked(
    accountId === null ? { kind: 'signed-out' } : { kind: 'account', accountId, roles: [] },
  );
}

/**
 * The account id, or `null` when the request is signed out, the credential is invalid, or
 * account-service did not answer. For the read routes, which never fail for lack of a credential.
 */
export async function identifyAccount(
  introspection: IntrospectionClient,
  req: Request,
): Promise<string | null> {
  const outcome = await authenticate(introspection, req);
  return outcome.kind === 'account' ? outcome.accountId : null;
}

/**
 * Per-request saved state for the read routes (#23). Reads add `isSaved` only for a caller that
 * resolves to an account, and never fail for one that does not.
 */
export interface SavedStateReader {
  /** Starts resolving the caller. Never rejects. */
  identify(req: Request): Promise<string | null>;
  /** The ids in `homeIds` that the account saved. */
  savedAmong(accountId: string, homeIds: readonly string[]): Promise<Set<string>>;
}

export function createSavedStateReader(
  pool: ReadClient,
  introspection: IntrospectionClient,
): SavedStateReader {
  return {
    identify: (req) => identifyAccount(introspection, req),
    savedAmong: (accountId, homeIds) => findSavedHomeIds(pool, accountId, homeIds),
  };
}

/** Adds the per-user flags to a card. Both names carry one value, resolved by home id. */
export function withSavedFlags<T extends { propertyId: string }>(
  card: T,
  saved: ReadonlySet<string>,
): T & { isSaved: boolean; isFavorited: boolean } {
  const isSaved = saved.has(card.propertyId.toLowerCase());
  return { ...card, isSaved, isFavorited: isSaved };
}

/** A response that carries a per-user value must never enter a shared cache. */
export const PRIVATE_CACHE_CONTROL = 'private, no-store';
