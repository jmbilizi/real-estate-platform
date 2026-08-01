import type { Config } from 'tailwindcss';

// Layout breakpoint — single source of truth for nav/search-bar ↔ desktop transition
// and map+grid column split. Keep this in sync with globals.css `--layout-break`.
const LAYOUT_BREAK = '768px';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // Semantic alias: use `layout:` prefix instead of `md:` for the layout split.
        // Both resolve to the same value so they're interchangeable, but `layout:`
        // makes the intent explicit and ties back to LAYOUT_BREAK above.
        layout: LAYOUT_BREAK,
      },
      colors: {
        // Primary: Coral Red — the single brand voltage (DESIGN.md `colors.primary`).
        // Numeric tints/shades below aren't part of DESIGN.md (hover states are intentionally
        // undocumented per its "Known Gaps") but are kept as coral-family interaction variants.
        brand: {
          DEFAULT: '#ff385c',
          active: '#e00b41',
          disabled: '#ffd1da',
          50: '#FFF1F3',
          100: '#FFE4E8',
          200: '#FECDD3',
          400: '#FB7185',
          500: '#FB5A75',
          600: '#ff385c',
          700: '#e00b41',
          900: '#881337',
        },
        // Sub-brand accents — Premium / Select contexts only (DESIGN.md `accent-deep`/`accent-rich`)
        accent: {
          deep: '#460479',
          rich: '#92174d',
        },
        // Neutral ink / typography (DESIGN.md `colors.ink`/`body`/`muted`/`muted-soft`)
        ink: {
          DEFAULT: '#222222',
          body: '#3f3f3f',
          muted: '#6a6a6a',
          subtle: '#929292',
        },
        // Surfaces (DESIGN.md `canvas`/`surface-soft`/`surface-strong`) — `alt`/`soft`/`border`
        // key names kept as-is (widely referenced) with values corrected to spec.
        surface: {
          DEFAULT: '#ffffff',
          alt: '#f7f7f7',
          soft: '#f2f2f2',
          border: '#dddddd',
          // DESIGN.md `border-strong` — the focused-input outline tone. The search
          // inputs used a coral focus ring, which is not a tone the system has for
          // this: brand coral is reserved for CTAs and the search orb.
          'border-strong': '#c1c1c1',
          // DESIGN.md `hairline-soft`. Was the search bar's active-segment and
          // dropdown-row fill; both now use `soft` (#f2f2f2) because #ebebeb read
          // as a pressed button rather than a highlight. Kept as a token because
          // DESIGN.md still specifies the value — currently unreferenced.
          pressed: '#ebebeb',
        },
      },
      fontFamily: {
        // Manrope Variable carries the entire scale — no separate display family (DESIGN.md)
        sans: [
          "'Manrope Variable'",
          "'Inter Variable'",
          '-apple-system',
          'system-ui',
          'Roboto',
          '"Helvetica Neue"',
          'sans-serif',
        ],
        display: [
          "'Manrope Variable'",
          "'Inter Variable'",
          '-apple-system',
          'system-ui',
          'Roboto',
          '"Helvetica Neue"',
          'sans-serif',
        ],
      },
      boxShadow: {
        // The system's single shadow tier (DESIGN.md Elevation) — hover-floated cards & dropdowns
        card: 'rgba(0, 0, 0, 0.02) 0 0 0 1px, rgba(0, 0, 0, 0.04) 0 2px 6px 0, rgba(0, 0, 0, 0.1) 0 4px 8px 0',
      },
      borderRadius: {
        // DESIGN.md `rounded` scale
        none: '0px',
        xs: '4px',
        sm: '8px',
        md: '14px',
        lg: '20px',
        xl: '32px',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        toastProgress: {
          '0%': { width: '100%' },
          '100%': { width: '0%' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.25s ease-out both',
        fadeUp: 'fadeUp 0.4s ease-out both',
        'toast-progress': 'toastProgress linear forwards',
      },
    },
  },
  plugins: [],
};

export default config;
