'use client';

import { useCallback, useState } from 'react';
import { useApp } from '@/lib/context';
import { useRouter } from 'next/navigation';
import { getUserDisplayName, getUserInitials } from '@/lib/store/types';
import { getProfile, ProfileResponse, updateProfile as updateProfileApi } from '@/lib/api/account';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { updateProfile } from '@/lib/store/slices/authSlice';
import { addToast } from '@/lib/store/slices/toastSlice';
import { selectUser } from '@/lib/store/selectors';

export default function AccountPage() {
  const { user, logout } = useApp();
  const router = useRouter();

  const openModal = (mode: 'login' | 'signup') => {
    const params = new URLSearchParams(window.location.search);
    params.set('modal', mode);
    router.push(`${window.location.pathname}?${params.toString()}`, { scroll: false });
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10">
          <svg
            className="h-8 w-8 text-brand"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </div>
        <h1 className="mt-6 font-display text-2xl font-bold tracking-tight">
          Sign in to your account
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Access your saved searches, listing history, messages, and account settings.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button onClick={() => openModal('login')} className="btn-primary">
            Sign in
          </button>
          <button onClick={() => openModal('signup')} className="btn-secondary">
            Create account
          </button>
        </div>
      </div>
    );
  }

  const displayName = getUserDisplayName(user);
  const initials = getUserInitials(user);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      {/* Profile header */}
      <div className="flex items-center gap-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-xl font-bold text-white">
          {initials}
        </div>
        <div>
          <h1 className="font-display text-2xl font-extrabold">{displayName}</h1>
          {displayName !== user.email && <p className="text-sm text-ink-muted">{user.email}</p>}
        </div>
      </div>

      {/* Editable profile section */}
      <ProfileSection />

      {/* Account sections */}
      <div className="mt-10 space-y-3">
        {ACCOUNT_SECTIONS.map((section) => (
          <div
            key={section.title}
            className="rounded-2xl border border-surface-border bg-white shadow-card"
          >
            <div className="px-5 py-4 border-b border-surface-border">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">
                {section.title}
              </h2>
            </div>
            <ul className="divide-y divide-surface-border">
              {section.items.map((item) => (
                <li key={item.label}>
                  <button
                    disabled
                    className="flex w-full items-center justify-between px-5 py-4 text-left opacity-60 cursor-not-allowed"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/10 text-brand">
                        {item.icon}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        {item.description && (
                          <p className="text-xs text-ink-muted">{item.description}</p>
                        )}
                      </div>
                    </div>
                    <svg
                      className="h-4 w-4 text-ink-muted"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-700 ring-1 ring-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Full account management coming soon
      </div>

      {/* Sign out */}
      <div className="mt-10">
        <button
          onClick={() => {
            logout();
            router.push('/');
          }}
          className="flex items-center gap-2 rounded-full border border-surface-border bg-white px-5 py-2.5 text-sm font-medium text-ink hover:bg-surface-alt transition-colors"
        >
          <svg
            className="h-4 w-4 text-ink-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          Sign out
        </button>
      </div>
    </div>
  );
}

/* ─── Editable Profile Section ────────────────────────────────────────────── */

function ProfileSection() {
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectUser);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [dateOfBirth, setDateOfBirth] = useState(user?.dateOfBirth || '');
  const [emailNotifications, setEmailNotifications] = useState(
    user?.emailNotificationsEnabled ?? true,
  );
  const [pushNotifications, setPushNotifications] = useState(
    user?.pushNotificationsEnabled ?? true,
  );
  const [smsNotifications, setSmsNotifications] = useState(user?.smsNotificationsEnabled ?? false);
  const [marketingOptIn, setMarketingOptIn] = useState(user?.marketingOptIn ?? false);

  const populateForm = useCallback((p: ProfileResponse) => {
    setFirstName(p.firstName || '');
    setLastName(p.lastName || '');
    setBio(p.bio || '');
    setDateOfBirth(p.dateOfBirth || '');
    setEmailNotifications(p.emailNotificationsEnabled ?? true);
    setPushNotifications(p.pushNotificationsEnabled ?? true);
    setSmsNotifications(p.smsNotificationsEnabled ?? false);
    setMarketingOptIn(p.marketingOptIn ?? false);
  }, []);

  const handleEdit = () => {
    setEditing(true);
    setLoading(true);
    getProfile()
      .then((p) => {
        populateForm(p);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const displayName =
        [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || undefined;
      await updateProfileApi({
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        displayName,
        bio: bio.trim() || undefined,
        dateOfBirth: dateOfBirth || undefined,
        emailNotificationsEnabled: emailNotifications,
        smsNotificationsEnabled: smsNotifications,
        pushNotificationsEnabled: pushNotifications,
        marketingOptIn,
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
    setSaving(false);
  };

  const handleCancel = () => {
    setEditing(false);
    // Reset form from current store state — no network call needed
    setFirstName(user?.firstName || '');
    setLastName(user?.lastName || '');
    setBio(user?.bio || '');
    setDateOfBirth(user?.dateOfBirth || '');
    setEmailNotifications(user?.emailNotificationsEnabled ?? true);
    setPushNotifications(user?.pushNotificationsEnabled ?? true);
    setSmsNotifications(user?.smsNotificationsEnabled ?? false);
    setMarketingOptIn(user?.marketingOptIn ?? false);
  };

  if (loading && editing) {
    return (
      <div className="mt-10 rounded-2xl border border-surface-border bg-white p-6 shadow-card animate-pulse">
        <div className="h-5 w-32 bg-surface-border rounded" />
        <div className="mt-4 space-y-3">
          <div className="h-10 bg-surface-border rounded" />
          <div className="h-10 bg-surface-border rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-10 rounded-2xl border border-surface-border bg-white shadow-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
        <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">
          Personal Information
        </h2>
        {!editing && (
          <button
            onClick={handleEdit}
            className="text-sm font-medium text-brand hover:text-brand/80 transition-colors"
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
            className="w-full rounded-xl border border-surface-border bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted/50 disabled:bg-surface-alt disabled:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-none"
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
          <h3 className="text-xs font-medium text-ink-muted mb-3 uppercase tracking-wide">
            Notifications
          </h3>
          <div className="space-y-3">
            <ToggleField
              label="Email notifications"
              description="New listings, price drops, saved search alerts"
              checked={emailNotifications}
              onChange={setEmailNotifications}
              disabled={!editing}
            />
            <ToggleField
              label="Push notifications"
              description="Real-time alerts on your device"
              checked={pushNotifications}
              onChange={setPushNotifications}
              disabled={!editing}
            />
            <ToggleField
              label="SMS notifications"
              description="Text messages for urgent updates"
              checked={smsNotifications}
              onChange={setSmsNotifications}
              disabled={!editing}
            />
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
              className="btn-primary rounded-full px-6 py-2.5 text-sm font-semibold"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="text-sm font-medium text-ink-muted hover:text-ink transition-colors"
            >
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
        className="w-full rounded-xl border border-surface-border bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted/50 disabled:bg-surface-alt disabled:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
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
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50 disabled:cursor-not-allowed ${
          checked ? 'bg-brand' : 'bg-gray-200'
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

const ACCOUNT_SECTIONS = [
  {
    title: 'Profile',
    items: [
      {
        label: 'Personal information',
        description: 'Name, email, phone number',
        icon: (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        ),
      },
      {
        label: 'Password & security',
        description: 'Change password, two-factor auth',
        icon: (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'My Activity',
    items: [
      {
        label: 'Saved homes',
        description: 'Homes you have hearted',
        icon: (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
        ),
      },
      {
        label: 'Saved searches',
        description: 'Search filters you have saved',
        icon: (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        ),
      },
      {
        label: 'Recently viewed',
        description: 'Listings you have visited',
        icon: (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Notifications',
    items: [
      {
        label: 'Alert preferences',
        description: 'Price drops, new listings, open houses',
        icon: (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
        ),
      },
      {
        label: 'Email & push settings',
        description: 'Control how we reach you',
        icon: (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'For Agents & Owners',
    items: [
      {
        label: 'My listings',
        description: 'Manage your active and past listings',
        icon: (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
            />
          </svg>
        ),
      },
      {
        label: 'Agent profile',
        description: 'Public profile, credentials, reviews',
        icon: (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
            />
          </svg>
        ),
      },
    ],
  },
];
