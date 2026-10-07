'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CONSENT_TEXTS,
  type ConsentChannel,
  CURRENT_CONSENT_TEXT_VERSION,
  type InquiryKind,
} from '@cribstop/property-contracts';
import { BRAND } from '@/lib/brand';
import { useApp } from '@/lib/context';
import { getProfile } from '@/lib/api/account';
import { InquiryError, submitInquiry } from '@/lib/api/inquiries';
import { normalizeUsPhone } from '@/lib/phone';

const MESSAGE_MAX = 2000;
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = 'name' | 'email' | 'phone' | 'message';
type Errors = Partial<Record<Field, string>>;
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
  const touched = useRef(new Set<Field>());

  const [values, setValues] = useState<Record<Field, string>>({
    name: '',
    email: '',
    phone: '',
    message: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const alertRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>({ status: 'editing' });

  // Prefill from the account. The profile can arrive after the dialog opens, so an untouched
  // field takes the late value. A field the user edited is never overwritten.
  const accountName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.name || '';
  const accountEmail = user?.email ?? '';
  useEffect(() => {
    setValues((prev) => ({
      ...prev,
      name: touched.current.has('name') ? prev.name : accountName,
      email: touched.current.has('email') ? prev.email : accountEmail,
    }));
  }, [accountName, accountEmail]);

  // The session knows the email but not whether it is confirmed. The profile says so. Until it
  // answers, or if it fails, the email stays editable: the service enforces the lock anyway.
  const signedIn = Boolean(user);
  const [lockedEmail, setLockedEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn) {
      setLockedEmail(null);
      return;
    }
    let live = true;
    getProfile()
      .then((profile) => {
        if (live) setLockedEmail(profile.emailConfirmed && profile.email ? profile.email : null);
      })
      .catch(() => {
        if (live) setLockedEmail(null);
      });
    return () => {
      live = false;
    };
  }, [signedIn]);
  const emailValue = lockedEmail ?? values.email;

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
        onCloseRef.current();
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
    touched.current.add(field);
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function validate(): Errors {
    const next: Errors = {};
    if (!values.name.trim()) next.name = 'Enter your name.';
    else if (values.name.trim().length > 200) next.name = 'Enter a shorter name.';
    if (!emailValue.trim()) next.email = 'Enter your email address.';
    else if (!EMAIL_PATTERN.test(emailValue.trim())) next.email = 'Enter a valid email address.';
    if (values.phone.trim() && !normalizeUsPhone(values.phone)) {
      next.phone = 'Enter a 10-digit US phone number, or leave it blank.';
    }
    if (kind === 'message' && !values.message.trim()) next.message = 'Write a message.';
    if (values.message.length > MESSAGE_MAX) {
      next.message = `Keep your message under ${MESSAGE_MAX} characters.`;
    }
    return next;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // A second submit while one is in flight must not send a second request.
    if (sendingRef.current) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const firstInvalid = (['name', 'email', 'phone', 'message'] as Field[]).find((f) => found[f]);
      if (firstInvalid)
        cardRef.current?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }

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
        name: values.name.trim(),
        email: emailValue.trim(),
        ...(phone && { phone }),
        ...(values.message.trim() && { message: values.message.trim() }),
        consentTextVersion: CURRENT_CONSENT_TEXT_VERSION,
        consentChannels,
      });
      setPhase({ status: 'sent' });
      requestAnimationFrame(() => doneRef.current?.focus());
    } catch (err) {
      const failure = err instanceof InquiryError ? err.failure : 'retryable';
      setPhase(
        failure === 'unavailable'
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
                  message: 'We could not send your request. Check your connection and try again.',
                },
      );
      requestAnimationFrame(() => alertRef.current?.focus());
    } finally {
      sendingRef.current = false;
    }
  }

  const sending = phase.status === 'sending';
  const submitLabel = sending ? 'Sending…' : phase.status === 'failed' ? 'Try Again' : copy.submit;

  function renderField(
    field: Field,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
  ) {
    const errorId = `${titleId}-${field}-error`;
    const noteId = `${titleId}-${field}-note`;
    const locked = field === 'email' && lockedEmail !== null;
    return (
      <div>
        <label htmlFor={`${titleId}-${field}`} className="mb-1 block text-sm font-medium text-ink">
          {label}
        </label>
        <input
          id={`${titleId}-${field}`}
          name={field}
          className="input-field"
          value={field === 'email' ? emailValue : values[field]}
          onChange={(e) => update(field, e.target.value)}
          aria-invalid={errors[field] ? true : undefined}
          aria-describedby={
            [errors[field] ? errorId : '', locked ? noteId : ''].filter(Boolean).join(' ') ||
            undefined
          }
          readOnly={sending || locked}
          {...props}
        />
        {locked && (
          <p id={noteId} className="mt-1 text-sm text-ink-muted">
            From your account
          </p>
        )}
        {errors[field] && (
          <p id={errorId} className="mt-1 text-sm text-red-700">
            {errors[field]}
          </p>
        )}
      </div>
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-request-dialog flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="buyer-agent-request-dialog"
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl sm:p-6"
      >
        {phase.status === 'sent' ? (
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

            {renderField('name', 'Name', { type: 'text', autoComplete: 'name' })}
            {renderField('email', 'Email', { type: 'email', autoComplete: 'email' })}
            {renderField('phone', 'Phone (optional)', { type: 'tel', autoComplete: 'tel' })}

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

            {!(phase.status === 'failed' && !phase.retryable) && (
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
