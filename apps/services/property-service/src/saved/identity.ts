import type { Request } from 'express';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import type { ReadClient } from '../listings/repository';
import { findSavedHomeIds } from './store';

/** A header Node may deliver as an array folds to its first value, never a comma-joined string. */
function firstHeaderValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

/**
 * Resolves the caller to an account id with account-service's introspection (#86), or `null` when
 * the request is signed out, the credential is invalid or revoked, or the call failed.
 * The result is never cached: account-service re-checks the security stamp on every request, so a
 * revoked session must stop working at once.
 */
export function identifyAccount(
  introspection: IntrospectionClient,
  req: Request,
): Promise<string | null> {
  return introspection.resolveAccountId({
    cookie: req.headers.cookie,
    authorization: req.headers.authorization,
    apiKey: firstHeaderValue(req.headers['x-api-key']),
  });
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
