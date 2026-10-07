'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CONSENT_TEXTS,
  type ConsentChannel,
  CURRENT_CONSENT_TEXT_VERSION,
  type InquiryKind,
} from '@cribstop/property-contracts';
import AuthForm from '@/components/AuthForm';
import { BRAND } from '@/lib/brand';
import { useApp } from '@/lib/context';
import { InquiryError, submitInquiry } from '@/lib/api/inquiries';
import { normalizeUsPhone } from '@/lib/phone';

const MESSAGE_MAX = 2000;
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

type Field = 'phone' | 'message';
type Errors = Partial<Record<Field, string>>;
type View = 'form' | 'auth';
type Phase =
  | { status: 'editing' }
  | { status: 'sending' }
  | { status: 'sent' }
  | { status: 'failed'; message: string; retryable: boolean };

const COPY: Record<InquiryKind, { title: string; submit: string; placeholder: string }> = {
  tour_request: {
    title: 'Request a Tour',
    submit: 'Send Tour Request',
    placeholder: 'Add a note for your buyer agent (optional)',
  },
  message: {
    title: 'Message Your Buyer Agent',
    submit: 'Send Message',
    placeholder: 'Write your message',
  },
};

interface Props {
  listingId: string;
  kind: InquiryKind;
  onClose: () => void;
}

/**
 * The buyer-agent request form (#132). One dialog serves every "Request a Tour" and "Message Agent"
 * button. The request goes to Cribstop as the consumer's buyer agent, never to the listing agent.
 * Fields are contact intent only (Fair Housing, PRD §6): no household, age, occupancy or
 * accessibility field, and no prompt that invites one.
 *
 * A request needs an account (#688). A signed-out buyer meets the email-code sign-in inside this
 * dialog, so the typed phone and message stay. The service takes the contact from the account.
 *
 * Rendered in a portal with its own key handling, because it opens over the listing modal. The
 * listing modal's Escape and Tab handlers sit on `window`, so this handler stops the event first.
 */
export default function BuyerAgentRequestDialog({ listingId, kind, onClose }: Props) {
  const { user } = useApp();
  const copy = COPY[kind];
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [values, setValues] = useState<Record<Field, string>>({ phone: '', message: '' });
  const [errors, setErrors] = useState<Errors>({});
  const alertRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>({ status: 'editing' });
  // `auth` shows the sign-in flow in place of the form. The typed input stays in state.
  const [view, setView] = useState<View>('form');
  const viewRef = useRef<View>('form');
  viewRef.current = view;
  // Set when a request met a 401. The request runs once more after sign-in.
  const [retryAfterAuth, setRetryAfterAuth] = useState(false);
  const autoRetryRef = useRef(false);
  // The account that met the 401. Only that account may send the kept request without a new click.
  const retryEmailRef = useRef('');

  // A new account has no name, and the session name is then its email.
  const signedIn = Boolean(user);
  const accountEmail = user?.email ?? '';
  const accountName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.name || accountEmail;

  // Back, Escape or the backdrop leave the sign-in step. A pending retry is dropped.
  function showForm() {
    setRetryAfterAuth(false);
    setView('form');
    requestAnimationFrame(() => cardRef.current?.querySelector<HTMLElement>('input')?.focus());
  }
  function signedInToForm() {
    setView('form');
    requestAnimationFrame(() => cardRef.current?.querySelector<HTMLElement>('input')?.focus());
  }
  const showFormRef = useRef(showForm);
  showFormRef.current = showForm;

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    // Lock only if nothing else has. The listing modal may already hold the lock.
    const lockedHere = root.style.overflow !== 'hidden';
    if (lockedHere) root.style.overflow = 'hidden';
    cardRef.current?.querySelector<HTMLElement>('input')?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        // Leaving the sign-in step returns to the form. It never closes the whole dialog.
        if (viewRef.current === 'auth') showFormRef.current();
        else onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      e.stopPropagation();
      const stops = Array.from(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !cardRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !cardRef.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (lockedHere) root.style.overflow = '';
      if (returnTo && document.contains(returnTo)) returnTo.focus();
    };
  }, []);

  function update(field: Field, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function validate(): Errors {
    const next: Errors = {};
    if (values.phone.trim() && !normalizeUsPhone(values.phone)) {
      next.phone = 'Enter a 10-digit US phone number, or leave it blank.';
    }
    if (kind === 'message' && !values.message.trim()) next.message = 'Write a message.';
    if (values.message.length > MESSAGE_MAX) {
      next.message = `Keep your message under ${MESSAGE_MAX} characters.`;
    }
    return next;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // A second submit while one is in flight must not send a second request.
    if (sendingRef.current) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const firstInvalid = (['phone', 'message'] as Field[]).find((f) => found[f]);
      if (firstInvalid)
        cardRef.current?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    autoRetryRef.current = false;
    if (!signedIn) {
      setView('auth');
      return;
    }
    void send();
  }

  async function send() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setPhase({ status: 'sending' });
    const phone = values.phone.trim() ? normalizeUsPhone(values.phone) : null;
    // The disclosure beside the button covers email, phone call and text.
    const consentChannels: ConsentChannel[] = phone
      ? ['email', 'phone_call', 'phone_text']
      : ['email'];
    try {
      await submitInquiry(listingId, {
        kind,
        ...(phone && { phone }),
        ...(values.message.trim() && { message: values.message.trim() }),
        consentTextVersion: CURRENT_CONSENT_TEXT_VERSION,
        consentChannels,
      });
      setPhase({ status: 'sent' });
      requestAnimationFrame(() => doneRef.current?.focus());
    } catch (err) {
      const failure = err instanceof InquiryError ? err.failure : 'retryable';
      if (failure === 'unauthorized' && !autoRetryRef.current) {
        // The session ended. Sign in again, then send once more.
        setPhase({ status: 'editing' });
        retryEmailRef.current = accountEmail;
        setRetryAfterAuth(true);
        setView('auth');
        return;
      }
      setPhase(
        failure === 'unauthorized'
          ? {
              status: 'failed',
              retryable: true,
              message: 'Your session ended. Select Try Again to sign in, then send your request.',
            }
          : failure === 'unconfirmed'
            ? {
                status: 'failed',
                retryable: false,
                message: 'Confirm your email address to send a request.',
              }
            : failure === 'unavailable'
              ? {
                  status: 'failed',
                  retryable: false,
                  message: 'This home is no longer available, so we could not send your request.',
                }
              : failure === 'invalid'
                ? {
                    status: 'failed',
                    retryable: true,
                    message: 'Check your details and try again.',
                  }
                : failure === 'rate_limited'
                  ? {
                      status: 'failed',
                      retryable: true,
                      message: 'Too many requests right now. Wait a moment, then try again.',
                    }
                  : {
                      status: 'failed',
                      retryable: true,
                      message:
                        'We could not send your request. Check your connection and try again.',
                    },
      );
      requestAnimationFrame(() => alertRef.current?.focus());
    } finally {
      sendingRef.current = false;
    }
  }

  // After a mid-request sign-in as the same account, send the kept request once.
  useEffect(() => {
    if (!retryAfterAuth || view !== 'form' || !signedIn) return;
    setRetryAfterAuth(false);
    // A different account sees its own details and consent text first, then sends by choice.
    if (accountEmail !== retryEmailRef.current) return;
    autoRetryRef.current = true;
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryAfterAuth, view, signedIn]);

  const sending = phase.status === 'sending';
  const submitLabel = !signedIn
    ? 'Sign in to continue'
    : sending
      ? 'Sending…'
      : phase.status === 'failed'
        ? 'Try Again'
        : copy.submit;
  const phoneErrorId = `${titleId}-phone-error`;

  return createPortal(
    <div
      className="fixed inset-0 z-request-dialog flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (view === 'auth') showForm();
        else onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="buyer-agent-request-dialog"
        className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-md sm:rounded-2xl ${
          view === 'auth' ? 'sm:bg-transparent sm:shadow-none' : 'p-5 sm:p-6'
        }`}
      >
        {view === 'auth' ? (
          <div>
            <p id={titleId} className="sr-only">
              Sign in to send your request
            </p>
            <button
              type="button"
              className="ml-2 mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-soft sm:bg-white"
              onClick={showForm}
            >
              <span aria-hidden="true">&larr;</span> Back to your request
            </button>
            <p className="px-6 pt-2 text-center text-sm leading-snug text-ink-muted">
              This request goes to {BRAND.siteName}, brokered by{' '}
              <span className="font-semibold">{BRAND.brokerage}</span>.
            </p>
            <AuthForm variant="modal" onSuccess={signedInToForm} />
          </div>
        ) : phase.status === 'sent' ? (
          <div role="status">
            <h2 id={titleId} className="text-xl font-semibold text-ink">
              We have your request
            </h2>
            <p className="mt-2 text-sm leading-snug text-ink-muted">
              {BRAND.siteName}, brokered by <span className="font-semibold">{BRAND.brokerage}</span>
              , has your {kind === 'tour_request' ? 'tour request' : 'message'}. We review it and
              match you with an agent when one is available.
              {kind === 'tour_request' && ' A tour request is not a booking.'}
            </p>
            <button
              ref={doneRef}
              type="button"
              className="btn-primary mt-5 min-h-11 w-full"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="text-xl font-semibold text-ink">
                {copy.title}
              </h2>
              <button
                type="button"
                aria-label="Close"
                className="-mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-soft"
                onClick={onClose}
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>

            <p className="text-sm leading-snug text-ink-muted">
              This request goes to {BRAND.siteName}, brokered by{' '}
              <span className="font-semibold">{BRAND.brokerage}</span>, as your buyer agent. It does
              not contact the listing agent. We use your contact details only to answer this
              request.
              {kind === 'tour_request' &&
                ' A tour request is not a booking. Touring with an agent may require a written buyer agreement.'}
            </p>

            {signedIn ? (
              <div
                data-testid="account-contact"
                className="rounded-xl bg-surface-soft px-4 py-3 text-sm"
              >
                <p className="text-ink-muted">From your account</p>
                {accountName !== accountEmail && (
                  <p className="font-medium text-ink [overflow-wrap:anywhere]">{accountName}</p>
                )}
                <p className="font-medium text-ink [overflow-wrap:anywhere]">{accountEmail}</p>
              </div>
            ) : (
              <p className="text-sm leading-snug text-ink" data-testid="account-required">
                You need a Cribstop account to send this request. Next, you sign in or create one
                with a code sent to your email. What you typed here stays.
              </p>
            )}

            <div>
              <label
                htmlFor={`${titleId}-phone`}
                className="mb-1 block text-sm font-medium text-ink"
              >
                Phone (optional)
              </label>
              <input
                id={`${titleId}-phone`}
                name="phone"
                type="tel"
                autoComplete="tel"
                className="input-field min-h-11"
                value={values.phone}
                onChange={(e) => update('phone', e.target.value)}
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={errors.phone ? phoneErrorId : undefined}
                readOnly={sending}
              />
              {errors.phone && (
                <p id={phoneErrorId} className="mt-1 text-sm text-red-700">
                  {errors.phone}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor={`${titleId}-message`}
                className="mb-1 block text-sm font-medium text-ink"
              >
                {kind === 'message' ? 'Message' : 'Note (optional)'}
              </label>
              <textarea
                id={`${titleId}-message`}
                name="message"
                rows={4}
                maxLength={MESSAGE_MAX}
                className="input-field"
                placeholder={copy.placeholder}
                value={values.message}
                onChange={(e) => update('message', e.target.value)}
                aria-invalid={errors.message ? true : undefined}
                aria-describedby={errors.message ? `${titleId}-message-error` : undefined}
                readOnly={sending}
              />
              {errors.message && (
                <p id={`${titleId}-message-error`} className="mt-1 text-sm text-red-700">
                  {errors.message}
                </p>
              )}
            </div>

            {phase.status === 'failed' && (
              <p
                ref={alertRef}
                role="alert"
                tabIndex={-1}
                className="text-sm font-medium text-red-700"
              >
                {phase.message}
              </p>
            )}

            {signedIn && !(phase.status === 'failed' && !phase.retryable) && (
              <p className="text-sm leading-snug text-ink" data-testid="consent-disclosure">
                By selecting “{phase.status === 'failed' ? 'Try Again' : copy.submit}”:{' '}
                {CONSENT_TEXTS[CURRENT_CONSENT_TEXT_VERSION]}
              </p>
            )}

            {phase.status === 'failed' && !phase.retryable ? (
              <button type="button" className="btn-secondary min-h-11 w-full" onClick={onClose}>
                Close
              </button>
            ) : (
              <button type="submit" className="btn-primary min-h-11 w-full" aria-disabled={sending}>
                {submitLabel}
              </button>
            )}
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
