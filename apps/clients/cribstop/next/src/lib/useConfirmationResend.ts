'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/lib/useToast';
import { RateLimitError, resendConfirmationEmail } from '@/lib/api/account';

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Drives the "resend confirmation link" control shared by the post-register waiting state, the
 * sign-in failure remedy, and the invalid-link page. The result is neutral in every case (#147):
 * a success and an unknown address get the same toast, and only a real `429` speaks differently,
 * using the server's `Retry-After` rather than a guess.
 */
export function useConfirmationResend() {
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => setCooldownSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  // Announced once when the cooldown starts, so assistive technology hears it without a
  // per-second stream of updates.
  const [cooldownAnnouncement, setCooldownAnnouncement] = useState('');

  const resend = useCallback(
    async (email: string) => {
      setIsSending(true);
      try {
        await resendConfirmationEmail(email);
        setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
        setCooldownAnnouncement(
          `If an account needs it, a new link is on its way. You can request another in ${RESEND_COOLDOWN_SECONDS} seconds.`,
        );
        toast('If an account needs it, a new link is on its way.', 'info');
      } catch (err) {
        if (err instanceof RateLimitError) {
          setCooldownSeconds(err.retryAfterSeconds);
          setCooldownAnnouncement(
            `You can request another link in ${err.retryAfterSeconds} seconds.`,
          );
          toast(`You can ask for another link in ${err.retryAfterSeconds} seconds.`, 'error');
        } else {
          toast('We could not send the request. Try again.', 'error');
        }
      } finally {
        setIsSending(false);
      }
    },
    [toast],
  );

  return { cooldownSeconds, isSending, resend, cooldownAnnouncement };
}
