'use client';

import { useState } from 'react';
import { useAppDispatch } from '@/lib/store/hooks';
import { dismissOnboarding, updateProfile } from '@/lib/store/slices/authSlice';
import { updateProfile as updateProfileApi } from '@/lib/api/account';
import { addToast } from '@/lib/store/slices/toastSlice';
import Modal from './Modal';

const STEPS = [
  {
    id: 'name',
    emoji: '👋',
    title: 'What should we call you?',
    subtitle: "Let's make this personal",
  },
  {
    id: 'preferences',
    emoji: '🏡',
    title: 'Stay in the loop',
    subtitle: 'Get notified about homes you love',
  },
] as const;

export default function OnboardingModal({ open }: { open: boolean }) {
  const dispatch = useAppDispatch();
  const [stepIdx, setStepIdx] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);
  const [saving, setSaving] = useState(false);

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const progress = ((stepIdx + 1) / STEPS.length) * 100;

  const handleSkip = () => {
    if (isLast) {
      dispatch(dismissOnboarding());
    } else {
      setStepIdx((i) => i + 1);
    }
  };

  const handleNext = async () => {
    setSaving(true);
    try {
      if (step.id === 'name' && (firstName.trim() || lastName.trim())) {
        const displayName = firstName.trim() || lastName.trim();
        await updateProfileApi({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          displayName,
        });
        dispatch(
          updateProfile({ firstName: firstName.trim(), lastName: lastName.trim(), displayName }),
        );
      } else if (step.id === 'preferences') {
        await updateProfileApi({
          emailNotificationsEnabled: emailNotifications,
          pushNotificationsEnabled: pushNotifications,
        });
      }
    } catch (err) {
      dispatch(
        addToast({
          id: `onboard-err-${Date.now()}`,
          message: err instanceof Error ? err.message : 'Could not save — try again later',
          type: 'error',
          duration: 4000,
        }),
      );
    }
    setSaving(false);

    if (isLast) {
      dispatch(dismissOnboarding());
      dispatch(
        addToast({
          id: `onboard-${Date.now()}`,
          message: "You're all set! Happy house hunting 🎉",
          type: 'success',
          duration: 4000,
        }),
      );
    } else {
      setStepIdx((i) => i + 1);
    }
  };

  const handleClose = () => {
    dispatch(dismissOnboarding());
  };

  return (
    <Modal open={open} onClose={handleClose} noPadding>
      <div className="p-6 sm:p-8">
        {/* Progress bar */}
        <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-surface-border">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Step header */}
        <div className="mb-6 text-center">
          <span className="text-4xl">{step.emoji}</span>
          <h2 className="mt-3 font-display text-xl font-bold tracking-tight">{step.title}</h2>
          <p className="mt-1 text-sm text-ink-muted">{step.subtitle}</p>
        </div>

        {/* Step content */}
        <div className="space-y-4">
          {step.id === 'name' && (
            <NameStep
              firstName={firstName}
              lastName={lastName}
              onFirstNameChange={setFirstName}
              onLastNameChange={setLastName}
            />
          )}
          {step.id === 'preferences' && (
            <PreferencesStep
              emailNotifications={emailNotifications}
              pushNotifications={pushNotifications}
              onEmailChange={setEmailNotifications}
              onPushChange={setPushNotifications}
            />
          )}
        </div>

        {/* Actions */}
        <div className="mt-8 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleSkip}
            className="text-sm font-medium text-ink-muted hover:text-ink-subtle transition-colors"
          >
            {isLast ? 'Maybe later' : 'Skip'}
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={saving}
            className="btn-primary rounded-full px-6 py-2.5 text-sm font-semibold"
          >
            {saving ? 'Saving...' : isLast ? 'Done!' : 'Continue'}
          </button>
        </div>

        {/* Step dots */}
        <div className="mt-5 flex justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === stepIdx
                  ? 'w-6 bg-brand'
                  : i < stepIdx
                    ? 'w-1.5 bg-brand/40'
                    : 'w-1.5 bg-surface-border'
              }`}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function NameStep({
  firstName,
  lastName,
  onFirstNameChange,
  onLastNameChange,
}: {
  firstName: string;
  lastName: string;
  onFirstNameChange: (v: string) => void;
  onLastNameChange: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-sm font-medium text-ink-muted">First name</label>
        <input
          type="text"
          className="input-field"
          placeholder="Your first name"
          value={firstName}
          onChange={(e) => onFirstNameChange(e.target.value)}
          autoFocus
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-ink-muted">Last name</label>
        <input
          type="text"
          className="input-field"
          placeholder="Your last name"
          value={lastName}
          onChange={(e) => onLastNameChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function PreferencesStep({
  emailNotifications,
  pushNotifications,
  onEmailChange,
  onPushChange,
}: {
  emailNotifications: boolean;
  pushNotifications: boolean;
  onEmailChange: (v: boolean) => void;
  onPushChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <ToggleRow
        emoji="📧"
        label="Email updates"
        description="New listings matching your searches"
        checked={emailNotifications}
        onChange={onEmailChange}
      />
      <ToggleRow
        emoji="🔔"
        label="Push notifications"
        description="Price drops and open house alerts"
        checked={pushNotifications}
        onChange={onPushChange}
      />
    </div>
  );
}

function ToggleRow({
  emoji,
  label,
  description,
  checked,
  onChange,
}: {
  emoji: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-surface-border p-3 transition-colors hover:bg-surface-alt/50">
      <span className="text-xl">{emoji}</span>
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-ink-muted">{description}</p>
      </div>
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div className="h-6 w-10 rounded-full bg-surface-border transition-colors peer-checked:bg-brand" />
        <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </div>
    </label>
  );
}
