import React from 'react';

const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** The one Filters icon, used by the list toolbar and the full map. */
export const FILTERS_ICON = (
  <svg {...ICON_PROPS}>
    <circle cx="17" cy="5" r="2" />
    <circle cx="7" cy="12" r="2" />
    <circle cx="17" cy="19" r="2" />
    <line x1="3" y1="5" x2="15" y2="5" />
    <line x1="9" y1="12" x2="21" y2="12" />
    <line x1="3" y1="19" x2="15" y2="19" />
  </svg>
);

/** The one Group icon, used by the list toolbar and the full map. */
export const GROUP_ICON = (
  <svg {...ICON_PROPS}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);

export interface ToolbarIconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  label: string;
  icon: React.ReactNode;
  /** Shows a badge when above 0. */
  count?: number;
  /** A toggle: sets `aria-pressed` and the dark pressed look. */
  pressed?: boolean;
  /** The dark look without `aria-pressed`, for a button that opens a menu. */
  active?: boolean;
  countTestId?: string;
}

/** The round icon-only button for Filters and Group, in the list toolbar and on the map (#748). */
export default function ToolbarIconButton({
  label,
  icon,
  count = 0,
  pressed,
  active,
  countTestId,
  className = '',
  type = 'button',
  ...rest
}: ToolbarIconButtonProps) {
  const dark = pressed || active;
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={`relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 shadow-[0_4px_16px_0_rgba(34,34,34,0.10)] transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${
        dark
          ? 'bg-ink text-white'
          : 'bg-white text-ink hover:bg-surface-soft aria-expanded:bg-surface-soft'
      } ${className}`}
      {...rest}
    >
      {icon}
      {count > 0 && (
        <span
          aria-hidden="true"
          data-testid={countTestId}
          className="absolute -right-0.5 -top-0.5 box-border h-[18px] min-w-[18px] rounded-full bg-ink px-1 text-center text-[11px] font-bold leading-[18px] text-white"
        >
          {count}
        </span>
      )}
    </button>
  );
}
