'use client';

import { useState } from 'react';
import Link from 'next/link';
import SlidePanel from './SlidePanel';

/** A single app tile displayed in the grid */
interface AppTile {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const APPS: AppTile[] = [
  // Row 1 — Core buyer loop (why most people come here)
  {
    label: 'Homes',
    href: '/',
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
    ),
  },
  {
    label: 'Services',
    href: '/services',
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"
        />
      </svg>
    ),
  },
  {
    label: 'Connect',
    href: '/connect',
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-1M3 8a2 2 0 012-2h8a2 2 0 012 2v5a2 2 0 01-2 2H9l-4 4V8z"
        />
      </svg>
    ),
  },
  // Row 2 — Marketplace (supply side + account)
  {
    label: 'Account',
    href: '/account',
    icon: (
      <svg
        className="h-5 w-5"
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
    label: 'Business',
    href: '/business',
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
        />
      </svg>
    ),
  },
  {
    label: 'List',
    href: '/list',
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    ),
  },
  // Row 3 — Personal tools
  {
    label: 'Saved',
    href: '/favorites',
    icon: (
      <svg
        className="h-5 w-5"
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
    label: 'Messages',
    href: '/messages',
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
        />
      </svg>
    ),
  },
  {
    label: 'Alerts',
    href: '/alerts',
    icon: (
      <svg
        className="h-5 w-5"
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
];

/**
 * AppsDropdown — waffle menu for site apps.
 *
 * The trigger is a 3×3 dot-grid icon.
 * Clicking it opens a SlidePanel sliding in from the top-right containing
 * a grid of app tiles.
 *
 * This is the first use of SlidePanel; the Account panel will follow the same pattern.
 */
export default function AppsDropdown() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      {/* Waffle / apps icon button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Site apps"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={[
          'flex items-center justify-center hover:text-brand',
          open ? 'text-brand' : 'text-ink',
        ].join(' ')}
      >
        <WaffleIcon className="h-5 w-5" />
      </button>

      <SlidePanel open={open} onClose={() => setOpen(false)} title="Apps" width={314}>
        {/* App grid — 3 columns, compact Google-style */}
        <div className="grid grid-cols-3 px-2 pt-1 pb-2">
          {APPS.map((app) => (
            <Link
              key={app.label}
              href={app.href}
              onClick={() => setOpen(false)}
              className="group flex flex-col items-center gap-[7px] rounded-2xl px-1 py-3 hover:bg-surface-alt transition-colors duration-150"
            >
              {/* Icon circle — stays tinted; subtle ring on hover */}
              <span
                className={[
                  'flex h-[52px] w-[52px] items-center justify-center rounded-full',
                  'bg-brand/[0.08] text-brand',
                  'ring-1 ring-transparent group-hover:ring-brand/20',
                  'transition-all duration-150',
                ].join(' ')}
              >
                {app.icon}
              </span>
              <span className="text-[11.5px] font-medium text-ink/80 leading-tight text-center">
                {app.label}
              </span>
            </Link>
          ))}
        </div>

        {/* Divider + footer */}
        <div className="mx-4 border-t border-black/[0.06]" />
        <p className="py-3 text-center text-[11px] text-ink-muted/70 tracking-wide uppercase font-medium">
          More coming soon
        </p>
      </SlidePanel>
    </div>
  );
}

/** 3×3 dot-grid waffle icon — same visual as Google's apps button */
function WaffleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="5" r="1.8" />
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="19" cy="5" r="1.8" />
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
      <circle cx="5" cy="19" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
      <circle cx="19" cy="19" r="1.8" />
    </svg>
  );
}
