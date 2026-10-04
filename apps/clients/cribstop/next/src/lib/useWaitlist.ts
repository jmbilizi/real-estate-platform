'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import { useToast } from '@/lib/useToast';
import {
  getWaitlistInterests,
  joinWaitlist,
  leaveWaitlist,
  type WaitlistInterest,
} from '@/lib/api/waitlist';

/**
 * A pending join expires, so a visitor who closes the login modal is not joined by a later login.
 * The hook cannot read the modal state: `useSearchParams` would force the page out of static
 * prerendering without a Suspense boundary, which would drop the page body from the first HTML.
 */
const PENDING_JOIN_TTL_MS = 5 * 60_000;

/**
 * Shared waitlist state for the gated-preview pages (Connect #89, Services #88).
 * One fetch per page, any number of interest kinds.
 *
 * An anonymous `toggle` opens the existing login modal and remembers the kind. The join runs once
 * the session exists. A visitor who signs up instead must confirm email first, so no session
 * appears and the join does not run. They tap the button again after they log in.
 */
export function useWaitlist() {
  const { user, sessionLoading } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();

  const [joined, setJoined] = useState<ReadonlySet<WaitlistInterest>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<WaitlistInterest>>(new Set());
  const pendingJoin = useRef<{ kind: WaitlistInterest; at: number } | null>(null);

  const setIn = (
    set: ReadonlySet<WaitlistInterest>,
    kind: WaitlistInterest,
    present: boolean,
  ): ReadonlySet<WaitlistInterest> => {
    const next = new Set(set);
    if (present) next.add(kind);
    else next.delete(kind);
    return next;
  };

  const join = useCallback(
    async (kind: WaitlistInterest) => {
      setBusy((s) => setIn(s, kind, true));
      setJoined((s) => setIn(s, kind, true));
      try {
        await joinWaitlist(kind);
      } catch {
        setJoined((s) => setIn(s, kind, false));
        toast('We could not add you to the list. Try again.', 'error');
      } finally {
        setBusy((s) => setIn(s, kind, false));
      }
    },
    [toast],
  );

  const withdraw = useCallback(
    async (kind: WaitlistInterest) => {
      setBusy((s) => setIn(s, kind, true));
      setJoined((s) => setIn(s, kind, false));
      try {
        await leaveWaitlist(kind);
      } catch {
        setJoined((s) => setIn(s, kind, true));
        toast('We could not remove you from the list. Try again.', 'error');
      } finally {
        setBusy((s) => setIn(s, kind, false));
      }
    },
    [toast],
  );

  const signedIn = Boolean(user);

  useEffect(() => {
    if (sessionLoading) return;
    if (!signedIn) {
      setJoined(new Set());
      setLoaded(true);
      return;
    }

    let cancelled = false;
    getWaitlistInterests()
      .then((kinds) => {
        if (!cancelled) setJoined(new Set(kinds));
      })
      .catch(() => {
        if (!cancelled) toast('We could not check your waitlist status.', 'error');
      })
      .finally(() => {
        if (cancelled) return;
        setLoaded(true);
        const pending = pendingJoin.current;
        pendingJoin.current = null;
        if (pending && Date.now() - pending.at < PENDING_JOIN_TTL_MS) void join(pending.kind);
      });

    return () => {
      cancelled = true;
    };
  }, [signedIn, sessionLoading, join, toast]);

  const toggle = useCallback(
    (kind: WaitlistInterest) => {
      if (!signedIn) {
        pendingJoin.current = { kind, at: Date.now() };
        router.push(`${pathname}?modal=login`, { scroll: false });
        return;
      }
      if (joined.has(kind)) void withdraw(kind);
      else void join(kind);
    },
    [signedIn, joined, join, withdraw, router, pathname],
  );

  return {
    /** False until the session and the joined list are known. */
    ready: loaded && !sessionLoading,
    isJoined: (kind: WaitlistInterest) => joined.has(kind),
    isBusy: (kind: WaitlistInterest) => busy.has(kind),
    toggle,
  };
}
