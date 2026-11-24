'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/lib/context';
import { openAuthModal } from '@/lib/auth-modal';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck,
  ChevronRight,
  Clock,
  Heart,
  Home,
  LogOut,
  Search,
  User as UserIcon,
} from 'lucide-react';
import { getUserDisplayName, getUserInitials } from '@/lib/store/types';
import { type ProfileUpdateRequest, updateProfile as updateProfileApi } from '@/lib/api/account';
import { accountKeys, profileOptions } from '@/lib/query/account';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { updateProfile } from '@/lib/store/slices/authSlice';
import { addToast } from '@/lib/store/slices/toastSlice';
import { selectUser } from '@/lib/store/selectors';
import AccountSecuritySection from '@/components/AccountSecuritySection';
import {
  ACCOUNT_CARD_CLASSES,
  ACCOUNT_CARD_HEADER_CLASSES,
  ACCOUNT_CARD_TITLE_CLASSES,
} from '@/components/account-card';
import EmailConsentNotice, { useConsentWording } from '@/components/EmailConsentNotice';
import { optInToEmail } from '@/lib/api/notification-preferences';
import LookingForSection from '@/components/LookingForSection';
import PersonaliseSwitch from '@/components/PersonaliseSwitch';

export default function AccountPage() {
  const { user, logout } = useApp();
  const router = useRouter();

  const openModal = (mode: 'login' | 'signup') => {
    openAuthModal(mode);
  };

  if (!user) {
    return (
      <div className="page-gutter mx-auto max-w-xl py-16 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
          <UserIcon className="h-8 w-8 text-brand" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Sign in to your account</h1>
        <p className="mt-2 text-[15px] text-ink-muted">
          See your saved homes and manage your account settings.
        </p>
        <div className="mt-6 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
          <button onClick={() => openModal('login')} className="btn-primary min-h-11">
            Sign in
          </button>
          <button onClick={() => openModal('signup')} className="btn-secondary min-h-11">
            Create account
          </button>
        </div>
      </div>
    );
  }

  const displayName = getUserDisplayName(user);
  const initials = getUserInitials(user);

  return (
    <div className="page-gutter mx-auto max-w-2xl py-8 sm:py-12">
      {/* Profile header */}
      <div className="flex items-center gap-4">
        {user.avatar ? (
          <img
            src={user.avatar}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand text-xl font-bold text-white"
          >
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold tracking-tight">{displayName}</h1>
          {displayName !== user.email && (
            <p className="break-words text-sm text-ink-muted">{user.email}</p>
          )}
        </div>
      </div>

      {/* Editable profile section */}
      <ProfileSection />

      <AccountSecuritySection />

      <LookingForSection />

      <section aria-labelledby="home-page-heading" className={ACCOUNT_CARD_CLASSES}>
        <div className={ACCOUNT_CARD_HEADER_CLASSES}>
          <h2 id="home-page-heading" className={ACCOUNT_CARD_TITLE_CLASSES}>
            Home page
          </h2>
        </div>
        <div className="px-5 py-3">
          <PersonaliseSwitch />
        </div>
      </section>

      <section aria-labelledby="activity-heading" className={ACCOUNT_CARD_CLASSES}>
        <div className={ACCOUNT_CARD_HEADER_CLASSES}>
          <h2 id="activity-heading" className={ACCOUNT_CARD_TITLE_CLASSES}>
            Your activity
          </h2>
        </div>
        <ul className="divide-y divide-surface-border">
          {ACTIVITY_LINKS.map(({ label, description, href, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium text-ink">{label}</span>
                    <span className="block text-[13px] text-ink-muted">{description}</span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
          {/* Not built yet. A row with no link and no button, so it promises no action. */}
          {COMING_SOON_ITEMS.map(({ label, description, icon: Icon }) => (
            <li key={label} className="flex min-h-14 items-center justify-between gap-3 px-5 py-3">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-alt text-ink-subtle">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-ink-muted">{label}</span>
                  <span className="block text-[13px] text-ink-subtle">{description}</span>
                </span>
              </span>
              <span className="badge shrink-0 bg-surface-alt text-ink-muted">Soon</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Sign out */}
      <div className="mt-8">
        <button
          onClick={() => {
            logout();
            router.push('/');
          }}
          className="btn-secondary min-h-11 w-full gap-2 sm:w-auto"
        >
          <LogOut className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  );
}

/* ─── Editable Profile Section ────────────────────────────────────────────── */

function ProfileSection() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const user = useAppSelector(selectUser);
  const [editing, setEditing] = useState(false);
  const profileQuery = useQuery({
    ...profileOptions(user?.email ?? ''),
    enabled: editing && !!user,
  });
  const loading = editing && profileQuery.isPending && profileQuery.fetchStatus !== 'idle';

  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [dateOfBirth, setDateOfBirth] = useState(user?.dateOfBirth || '');
  const [emailNotifications, setEmailNotifications] = useState(
    user?.emailNotificationsEnabled ?? false,
  );
  const [emailWasOn, setEmailWasOn] = useState(user?.emailNotificationsEnabled ?? false);
  const turningEmailOn = editing && emailNotifications && !emailWasOn;
  const { wording, failed: wordingFailed } = useConsentWording(turningEmailOn);
  const [marketingOptIn, setMarketingOptIn] = useState(user?.marketingOptIn ?? false);

  // Fill the form from the server profile. `profileStamp` changes on each new fetch.
  const profile = profileQuery.data;
  const profileStamp = profileQuery.dataUpdatedAt;
  useEffect(() => {
    if (!editing || !profile) return;
    setFirstName(profile.firstName || '');
    setLastName(profile.lastName || '');
    setBio(profile.bio || '');
    setDateOfBirth(profile.dateOfBirth || '');
    setEmailNotifications(profile.emailNotificationsEnabled ?? false);
    setEmailWasOn(profile.emailNotificationsEnabled ?? false);
    setMarketingOptIn(profile.marketingOptIn ?? false);
  }, [editing, profileStamp]);

  const handleEdit = () => setEditing(true);

  // An opt-in records the wording the user saw. An opt-out stays a plain profile update.
  const saveMutation = useMutation({
    mutationFn: async (input: { consentWordingId?: string; profile: ProfileUpdateRequest }) => {
      if (input.consentWordingId) await optInToEmail(input.consentWordingId);
      await updateProfileApi(input.profile);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.all }),
  });
  const saving = saveMutation.isPending;

  const handleSave = async () => {
    if (turningEmailOn && !wording) {
      dispatch(
        addToast({
          id: `consent-err-${Date.now()}`,
          message: 'Wait for the email consent wording to load, then save again',
          type: 'error',
          duration: 4000,
        }),
      );
      return;
    }
    try {
      const displayName =
        [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || undefined;
      await saveMutation.mutateAsync({
        consentWordingId: turningEmailOn && wording ? wording.id : undefined,
        profile: {
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          displayName,
          bio: bio.trim() || undefined,
          dateOfBirth: dateOfBirth || undefined,
          emailNotificationsEnabled: emailNotifications ? undefined : false,
          marketingOptIn,
        },
      });
      dispatch(
        updateProfile({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          displayName: displayName || undefined,
          bio: bio.trim(),
          dateOfBirth,
          profileComplete: true,
        }),
      );
      dispatch(
        addToast({
          id: `profile-${Date.now()}`,
          message: 'Profile updated',
          type: 'success',
          duration: 3000,
        }),
      );
      setEmailWasOn(emailNotifications);
      setEditing(false);
    } catch (err) {
      dispatch(
        addToast({
          id: `profile-err-${Date.now()}`,
          message: err instanceof Error ? err.message : 'Could not save profile',
          type: 'error',
          duration: 4000,
        }),
      );
    }
  };

  const handleCancel = () => {
    setEditing(false);
    // Reset form from current store state — no network call needed
    setFirstName(user?.firstName || '');
    setLastName(user?.lastName || '');
    setBio(user?.bio || '');
    setDateOfBirth(user?.dateOfBirth || '');
    setEmailNotifications(user?.emailNotificationsEnabled ?? false);
    setEmailWasOn(user?.emailNotificationsEnabled ?? false);
    setMarketingOptIn(user?.marketingOptIn ?? false);
  };

  if (loading && editing) {
    return (
      <div className={`${ACCOUNT_CARD_CLASSES} animate-pulse p-5`}>
        <div className="h-5 w-32 bg-surface-border rounded" />
        <div className="mt-4 space-y-3">
          <div className="h-10 bg-surface-border rounded" />
          <div className="h-10 bg-surface-border rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className={`${ACCOUNT_CARD_CLASSES} overflow-hidden`}>
      <div className={ACCOUNT_CARD_HEADER_CLASSES}>
        <h2 className={ACCOUNT_CARD_TITLE_CLASSES}>Personal information</h2>
        {!editing && (
          <button
            onClick={handleEdit}
            className="-mr-3 inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-brand hover:bg-brand/10"
          >
            Edit
          </button>
        )}
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* Name fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField
            label="First name"
            value={firstName}
            onChange={setFirstName}
            disabled={!editing}
            placeholder="Your first name"
          />
          <InputField
            label="Last name"
            value={lastName}
            onChange={setLastName}
            disabled={!editing}
            placeholder="Your last name"
          />
        </div>

        {/* Bio */}
        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1.5">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            disabled={!editing}
            placeholder="A little about yourself"
            rows={3}
            maxLength={280}
            className="input-field resize-none disabled:bg-surface-alt disabled:text-ink-muted"
          />
        </div>

        {/* Date of birth */}
        <InputField
          label="Date of birth"
          type="date"
          value={dateOfBirth}
          onChange={setDateOfBirth}
          disabled={!editing}
        />

        {/* Notification preferences */}
        <div className="border-t border-surface-border pt-5">
          <h3 className="mb-3 text-[15px] font-semibold text-ink">Notifications</h3>
          <div className="space-y-3">
            <ToggleField
              label="Email notifications"
              description="Email alerts are not live yet. Your choice is saved for when they launch. Turn this off here at any time."
              checked={emailNotifications}
              onChange={setEmailNotifications}
              disabled={!editing}
            />
            {turningEmailOn && <EmailConsentNotice wording={wording} failed={wordingFailed} />}
            <ComingSoonToggle label="Push notifications" />
            <ComingSoonToggle label="SMS notifications" />
            <ToggleField
              label="Marketing emails"
              description="Tips, market reports, and promotions"
              checked={marketingOptIn}
              onChange={setMarketingOptIn}
              disabled={!editing}
            />
          </div>
        </div>

        {/* Actions */}
        {editing && (
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary min-h-11 px-6 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            <button onClick={handleCancel} disabled={saving} className="btn-secondary min-h-11">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */

function InputField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-muted mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="input-field min-h-11 disabled:bg-surface-alt disabled:text-ink-muted"
      />
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer">
      <div>
        <p className="text-[15px] font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50 disabled:cursor-not-allowed ${
          checked ? 'bg-brand' : 'bg-surface-border'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}

/** A switch with no state and no handler. It promises nothing until delivery exists (#123). */
function ComingSoonToggle({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[15px] font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-muted">Coming soon</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={false}
        aria-label={`${label}, coming soon`}
        disabled
        className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-not-allowed rounded-full border-2 border-transparent bg-surface-border opacity-50"
      >
        <span className="pointer-events-none inline-block h-5 w-5 translate-x-0 rounded-full bg-white shadow ring-0" />
      </button>
    </div>
  );
}

const ACTIVITY_LINKS: { label: string; description: string; href: string; icon: LucideIcon }[] = [
  {
    label: 'Saved',
    description: 'What you saved with the heart',
    href: '/account/favorites',
    icon: Heart,
  },
  {
    label: 'Recently viewed',
    description: 'What you opened, newest first',
    href: '/account/recently-viewed',
    icon: Clock,
  },
];

const COMING_SOON_ITEMS: { label: string; description: string; icon: LucideIcon }[] = [
  { label: 'Saved searches', description: 'Search filters you save', icon: Search },
  { label: 'My listings', description: 'Your active and past listings', icon: Home },
  { label: 'Agent profile', description: 'Public profile and credentials', icon: BadgeCheck },
];
