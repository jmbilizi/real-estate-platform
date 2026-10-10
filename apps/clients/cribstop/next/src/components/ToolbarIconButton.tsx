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

/** The one Sort icon. */
export const SORT_ICON = (
  <svg {...ICON_PROPS}>
    <path d="m3 18 4 4 4-4" />
    <path d="M7 22V2" />
    <path d="m21 6-4-4-4 4" />
    <path d="M17 2v20" />
  </svg>
);

/** The full-screen map icons. */
export const EXPAND_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M7 3H3v4" />
    <path d="M17 3h4v4" />
    <path d="M3 17v4h4" />
    <path d="M21 17v4h-4" />
  </svg>
);

export const EXIT_EXPAND_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M3 8h5V3" />
    <path d="M21 8h-5V3" />
    <path d="M3 16h5v5" />
    <path d="M21 16h-5v5" />
  </svg>
);

/** The close (X) icon. */
export const CLOSE_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

/** The back and previous chevron. */
export const BACK_ICON = (
  <svg {...ICON_PROPS}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);

/** The next chevron. */
export const FORWARD_ICON = (
  <svg {...ICON_PROPS}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

/** The share icon. */
export const SHARE_ICON = (
  <svg {...ICON_PROPS}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);

/** The save (heart) icon. The active look fills it. */
export const HEART_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />
  </svg>
);

/** The zoom-in icon. */
export const PLUS_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** The zoom-out icon. */
export const MINUS_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M5 12h14" />
  </svg>
);

/** The draw-area icon. */
export const DRAW_ICON = (
  <svg
    width={22}
    height={22}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

/** The clear-area icon. */
export const CLEAR_ICON = (
  <svg
    width={22}
    height={22}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export interface ToolbarIconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  label: string;
  /** The hover tooltip. Defaults to `label`; set it when the label carries state, such as a count. */
  tooltip?: string;
  icon: React.ReactNode;
  /** Shows a badge when above 0. */
  count?: number;
  /** A toggle: sets `aria-pressed` and the active look (darker, filled icon). */
  pressed?: boolean;
  /** The active look without `aria-pressed`, for a button that opens a menu. */
  active?: boolean;
  countTestId?: string;
  /**
   * Where the button sits. `page` (default) is transparent. `map` is white with a light shadow,
   * for a button over map tiles (#764). Nothing else differs.
   */
  surface?: 'page' | 'map';
  /** `sm` is a 32px circle with a 44px tap area, for inline row controls such as carousel arrows. */
  size?: 'md' | 'sm';
}

const SIZE_CLASSES = {
  md: 'h-11 w-11',
  sm: "h-8 w-8 before:absolute before:-inset-1.5 before:content-['']",
} as const;

export const SURFACE_CLASSES = {
  page: 'bg-transparent hover:bg-surface-soft disabled:hover:bg-transparent aria-expanded:bg-surface-soft',
  map: 'bg-white shadow-[0_1px_4px_rgba(34,34,34,0.25)] hover:bg-gray-100 disabled:hover:bg-white aria-expanded:bg-gray-100',
} as const;

/** The one round icon-only toolbar button: list toolbar and map (#748, #758). A transparent fill and a light border, on every surface. */
export default function ToolbarIconButton({
  label,
  tooltip,
  icon,
  count = 0,
  pressed,
  active,
  countTestId,
  surface = 'page',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: ToolbarIconButtonProps) {
  const dark = pressed || active;
  // An absolutely placed button is already a positioning context for the badge.
  const position = /\b(absolute|fixed|sticky)\b/.test(className) ? '' : 'relative';
  // The active look is a darker icon and a filled glyph, never a filled button.
  const glyph =
    dark && React.isValidElement<React.SVGProps<SVGSVGElement>>(icon)
      ? React.cloneElement(icon, { fill: 'currentColor' })
      : icon;
  return (
    <button
      type={type}
      aria-label={label}
      title={tooltip ?? label}
      aria-pressed={pressed}
      className={`${position} inline-flex ${SIZE_CLASSES[size]} shrink-0 cursor-pointer items-center justify-center rounded-full border border-gray-300 ${SURFACE_CLASSES[surface]} disabled:cursor-not-allowed transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${
        dark ? 'text-ink' : 'text-ink-muted'
      } ${className}`}
      {...rest}
    >
      {glyph}
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
