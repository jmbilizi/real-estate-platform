---
version: alpha
name: Cribstop-design-system
description:
  The Cribstop real estate platform design system — a warm, photography-led consumer marketplace
  anchored on a clean white canvas and Coral Red (#ff385c), the single brand voltage that carries
  every primary CTA, search-button orb, and save-heart state. Type runs Manrope Variable at modest
  weights — display sits at 22-28px in weight 500/600 rather than the heavy 700+ that fintech and
  enterprise systems use; the brand trusts property photography and generous whitespace over
  typographic muscle. Three product tabs (Homes, Services, Connect) sit in the top nav with
  hand-illustrated 32px icon glyphs, reflecting the platform's three consumer experiences — a
  buy/sell/rent marketplace, a professional services directory, and a community layer. Pill-shaped
  search bars (`{rounded.full}`), softly rounded listing cards (`{rounded.md}` ~14px), and 32px
  button radii read as friendly and human — there is no hard corner anywhere except the body grid.
  Brokerage attribution (Real Broker, LLC) is always the most prominent brand element per MLS rules;
  "Cribstop" is the secondary product/marketplace name.

colors:
  primary: '#ff385c'
  primary-active: '#e00b41'
  primary-disabled: '#ffd1da'
  primary-error-text: '#c13515'
  primary-error-text-hover: '#b32505'
  accent-deep: '#460479'
  accent-rich: '#92174d'
  ink: '#222222'
  body: '#3f3f3f'
  muted: '#6a6a6a'
  muted-soft: '#929292'
  hairline: '#dddddd'
  hairline-soft: '#ebebeb'
  border-strong: '#c1c1c1'
  canvas: '#ffffff'
  surface-soft: '#f7f7f7'
  surface-card: '#ffffff'
  surface-strong: '#f2f2f2'
  on-primary: '#ffffff'
  on-dark: '#ffffff'
  legal-link: '#428bff'
  star-rating: '#222222'
  scrim: '#000000'

typography:
  display-xl:
    fontFamily:
      "'Manrope Variable', Inter Variable, -apple-system, system-ui, Roboto, 'Helvetica Neue',
      sans-serif"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.43
    letterSpacing: 0
  display-lg:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1.18
    letterSpacing: -0.44px
  display-md:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 21px
    fontWeight: 700
    lineHeight: 1.43
    letterSpacing: 0
  display-sm:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.20
    letterSpacing: -0.18px
  title-md:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0
  title-sm:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0
  rating-display:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 64px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -1px
  body-md:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: 0
  caption:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.29
    letterSpacing: 0
  caption-sm:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.23
    letterSpacing: 0
  badge:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: 0
  micro-label:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 12px
    fontWeight: 700
    lineHeight: 1.33
    letterSpacing: 0
  uppercase-tag:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 8px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0.32px
    textTransform: uppercase
  button-md:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0
  button-sm:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.29
    letterSpacing: 0
  link:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: 0
  nav-link:
    fontFamily: "'Manrope Variable', 'Inter Variable', sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0

rounded:
  none: 0px
  xs: 4px
  sm: 8px
  md: 14px
  lg: 20px
  xl: 32px
  full: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  base: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 64px

components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.button-md}'
    rounded: '{rounded.sm}'
    padding: 14px 24px
    height: 48px
  button-primary-active:
    backgroundColor: '{colors.primary-active}'
    textColor: '{colors.on-primary}'
    rounded: '{rounded.sm}'
  button-primary-disabled:
    backgroundColor: '{colors.primary-disabled}'
    textColor: '{colors.on-primary}'
    rounded: '{rounded.sm}'
  button-secondary:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.button-md}'
    rounded: '{rounded.sm}'
    padding: 13px 23px
    height: 48px
  button-tertiary-text:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.button-md}'
  button-pill-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.button-sm}'
    rounded: '{rounded.full}'
    padding: 10px 20px
  search-orb:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    rounded: '{rounded.full}'
    height: 48px
  icon-button-circle:
    backgroundColor: '{colors.surface-strong}'
    textColor: '{colors.ink}'
    rounded: '{rounded.full}'
    height: 32px
  icon-button-outline:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    rounded: '{rounded.full}'
    height: 40px
  top-nav:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.nav-link}'
    height: 80px
  brokerage-badge:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.caption-sm}'
    note: 'Real Broker, LLC — most prominent brand per MLS rules'
  product-tab-active:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.nav-link}'
    rounded: '{rounded.none}'
  product-tab-inactive:
    backgroundColor: transparent
    textColor: '{colors.muted}'
    typography: '{typography.nav-link}'
  search-bar-pill:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.full}'
    padding: 14px 24px
    height: 64px
  search-bar-homes:
    note: 'Segments: Location / Price / Home Type / Intent (Buy·Rent·Sell)'
    backgroundColor: '{colors.canvas}'
    rounded: '{rounded.full}'
    height: 64px
  search-bar-services:
    note: 'Segments: What (category) / Where (DMV location)'
    backgroundColor: '{colors.canvas}'
    rounded: '{rounded.full}'
    height: 64px
  search-bar-connect:
    note: 'Segments: People · Topics · Neighborhoods · Groups'
    backgroundColor: '{colors.canvas}'
    rounded: '{rounded.full}'
    height: 64px
  search-field-segment:
    backgroundColor: transparent
    backgroundColorFocus: '{colors.surface-strong}'
    backgroundColorHover: '{colors.surface-soft}' # at 60% over the white bar
    textColor: '{colors.ink}'
    typography: '{typography.caption}'
    padding: 8px 24px
  search-dropdown:
    note: 'Panel under an open segment; 6px gap, flush with the bar edges'
    backgroundColor: '{colors.canvas}'
    rounded: '{rounded.xl}'
    border: '1px {colors.hairline}'
    shadow: 'system tier'
    rowBackgroundColorHover: '{colors.surface-strong}'
  search-field-input:
    note: 'Rounded input inside an open segment dropdown; carries no shadow of its own'
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    rounded: '{rounded.full}'
    border: '1px {colors.hairline}'
    borderFocus: '1px {colors.border-strong}'
    padding: 12px 20px
  intent-toggle:
    note: 'Buy / Rent / Sell pill toggle inside Homes search'
    backgroundColor: '{colors.surface-soft}'
    textColor: '{colors.ink}'
    typography: '{typography.button-sm}'
    rounded: '{rounded.full}'
  intent-toggle-active:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.on-dark}'
    rounded: '{rounded.full}'
  category-strip:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.muted}'
    typography: '{typography.button-sm}'
  category-tab-active:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.button-sm}'
    rounded: '{rounded.none}'
  listing-card:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    note: 'Photo-first card for homes — price, address, beds/baths/sqft, broker attribution'
  listing-card-photo:
    rounded: '{rounded.md}'
  listing-badge:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.badge}'
    rounded: '{rounded.full}'
    padding: 4px 10px
    note: 'Just Listed / Price Reduced / Open House / New Construction'
  provider-card:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    note: 'Service provider — photo, name, category, rating, price range, Verified badge'
  verified-badge:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.badge}'
    rounded: '{rounded.full}'
    padding: 4px 10px
    note:
      "Provider credential badge — scoped per category (an inspector's badge never renders on the
      same account's other-category profile)"
  verified-resident-badge:
    backgroundColor: '{colors.surface-strong}'
    textColor: '{colors.ink}'
    typography: '{typography.badge}'
    rounded: '{rounded.full}'
    padding: 4px 10px
    note:
      'Connect posts/membership — neighborhood-level only, never a street address; from an approved
      resident/owner property claim'
  mentor-badge:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.badge}'
    rounded: '{rounded.full}'
    padding: 4px 10px
    note:
      'Open to mentor / shadow-a-pro opt-in on provider profiles — 1px ink outline, distinct CTA'
  mentorship-request-card:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 24px
    note:
      'Mentorship & guidance: licensing/education info by category + request mentor / shadow-a-pro
      CTA — no payment step'
  sponsored-label:
    backgroundColor: '{colors.surface-soft}'
    textColor: '{colors.muted}'
    typography: '{typography.uppercase-tag}'
    rounded: '{rounded.xs}'
    padding: 2px 6px
    note:
      'Required on any paid/featured provider placement, especially inside Connect (FTC disclosure)
      — never presented as organic ranking'
  community-post-card:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 16px
    note: 'Connect feed — avatar, author, timestamp, post body, reactions, comments'
  neighborhood-group-card:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.title-md}'
    rounded: '{rounded.md}'
    note: 'Neighborhood group tile in Connect'
  gated-preview-overlay:
    backgroundColor: '{colors.scrim}'
    textColor: '{colors.on-dark}'
    note: 'Blurred preview for unauthenticated users with sign-up CTA'
  apps-panel:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 16px
    note: 'Waffle menu: Account, Business, List a Property, Saved, Messages, Alerts'
  new-tag:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.uppercase-tag}'
    rounded: '{rounded.full}'
    padding: 2px 6px
  amenity-row:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    padding: 12px 0
  reviews-card:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
  broker-attribution-bar:
    backgroundColor: '{colors.surface-soft}'
    textColor: '{colors.muted}'
    typography: '{typography.caption-sm}'
    padding: 8px 16px
    note:
      'Listing broker name/phone/email + office — required wherever a listing renders, including
      listing cards inside Connect feeds'
  listing-detail-header:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.display-lg}'
    note: 'Property address, price, beds/baths/sqft, status badge'
  listing-detail-gallery:
    rounded: '{rounded.md}'
    note: "5-photo collage (1 hero + 4 grid) with 'Show all photos' overlay button"
  inquiry-card:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 24px
    note:
      'Sticky right-rail CTA: price, mortgage teaser, Contact Agent / Schedule Tour / Request Info'
  mortgage-teaser:
    backgroundColor: '{colors.surface-soft}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.sm}'
    padding: 12px 16px
    note: 'Estimated monthly payment preview inside inquiry-card'
  map-marker:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.badge}'
    rounded: '{rounded.full}'
    note: 'Coral pin with price label on map view'
  map-marker-active:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.on-dark}'
    rounded: '{rounded.full}'
  saved-search-alert-card:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    padding: 16px
    note: 'Saved search criteria + frequency toggle + alert toggle'
  provider-profile-header:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.display-lg}'
    note: 'Provider name, business name, photo, category, Verified badge, rating'
  provider-service-package:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.sm}'
    padding: 16px
    note: 'Named offering: title, description, price/range, duration, Book/Request CTA'
  booking-flow-card:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 24px
    note: 'Bookable appointment: date/time picker + property address + confirm CTA'
  lead-form-card:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 24px
    note: 'Lead & consultation: goal, timeline, budget, property interest → submit'
  quote-request-card:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 24px
    note: 'Quote & project: scope, budget, timeline, media → submit'
  quote-comparison-row:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.sm}'
    padding: 16px
    note: 'Returned quote from provider: price, scope, timeline, Accept CTA'
  chat-bubble-sent:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 10px 14px
  chat-bubble-received:
    backgroundColor: '{colors.surface-soft}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 10px 14px
  chat-list-item:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    padding: 12px 16px
    note: 'Conversation row: avatar, name, last message preview, timestamp, unread dot'
  notification-bell:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    rounded: '{rounded.full}'
    height: 40px
    note: 'Bell icon with coral unread-count badge'
  notification-item:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    padding: 12px 16px
  auth-modal:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 32px
    note: 'Login / Sign Up / Forgot Password modal with social sign-in buttons'
  social-sign-in-button:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.button-md}'
    rounded: '{rounded.sm}'
    padding: 14px 24px
    height: 48px
    note: 'Continue with Google / Continue with Apple — 1px ink outline'
  avatar:
    rounded: '{rounded.full}'
    note: 'Sizes: 24px (inline), 32px (nav), 40px (card), 56px (profile), 96px (detail)'
  text-input:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.sm}'
    padding: 14px 12px
    height: 56px
  date-picker-day:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.full}'
  date-picker-day-selected:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.on-dark}'
    rounded: '{rounded.full}'
  filter-pill:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.button-sm}'
    rounded: '{rounded.full}'
    padding: 8px 16px
    note: 'Active filter state has 1px ink outline; inactive has hairline'
  filter-pill-active:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    rounded: '{rounded.full}'
    borderColor: '{colors.ink}'
    borderWidth: 2px
  footer-light:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    padding: 48px 80px
  footer-link:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
  legal-band:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.muted}'
    typography: '{typography.caption-sm}'
    note:
      '© 2026 Cribstop.com | Brokered by Real Broker, LLC | MD · DC · VA | Equal Housing
      Opportunity'
---

## Overview

This marketplace pattern is a canonical example of a generous, photography-led consumer marketplace.
The base canvas is **pure white** (`{colors.canvas}` - #ffffff) with deep near-black ink
(`{colors.ink}` - #222222) for headlines and body, and a single voltage of **Coral Red**
(`{colors.primary}` - #ff385c) carrying every primary CTA, the search-button orb, the heart save
state, and inline brand links. There is no secondary brand color in mainline marketing - the
**Premium purple** (`{colors.accent-deep}` - #460479) and **Select magenta**
(`{colors.accent-rich}` - #92174d) tokens are sub-brand accents that only appear inside premium /
Select contexts.

Type runs **Manrope Variable** (an open-source variable font stack), with **Inter Variable** as the
historic in-house fallback and a system stack underneath. The stack sits at modest weights - display
headlines render at 22-28px in weight 500-600, not the heavy 700+ weights that financial or
enterprise systems lean on. The homepage carries no large hero headline at all - the layout leans on
photography (neighborhood collage, listing cards) for visual weight rather than typographic muscle.

The shape language is **soft**. Buttons are 8px radius (`{rounded.sm}`), property cards are ~14px
(`{rounded.md}`), the search bar is fully pill-shaped (`{rounded.full}`), wishlist hearts and search
orbs are circles (`{rounded.full}`), and category strip rounded corners run at 32px
(`{rounded.xl}`). There is essentially no hard corner anywhere except the body grid itself - every
interactive element is rounded.

**Key Characteristics:**

- Single accent color: `{colors.primary}` (#ff385c - "Coral Red") carries every primary CTA, the
  search orb, the heart save state, and the brand wordmark. Used scarcely - most pages are 90%
  white + ink with one or two Coral moments.
- Custom variable type: `Manrope Variable`. Display weights sit at 500-700, body at 400. Modest
  weight is intentional - the system trusts photography for visual heft.
- Three-product top nav: Homes, Services, Connect - each with a hand-illustrated 32px icon and "NEW"
  badges (`{component.new-tag}`) on the two newer products. Active tab uses an underline rule
  (`{component.product-tab-active}`).
- Pill-shaped contextual search bar per tab: white surface, fully rounded (`{rounded.full}`),
  divided by 1px hairlines into segments — Homes: Location / Price / Home Type / Intent
  (Buy·Rent·Sell); Services: What / Where; Connect: People · Topics · Neighborhoods · Groups —
  terminated by a circular coral search orb (`{component.search-orb}`).
- Listing cards are photo-first: aspect-ratio rectangles with `{rounded.md}` corner clipping,
  swipeable image carousel, `{component.listing-badge}` ("Just Listed" / "Price Reduced" / "Open
  House") floating top-left, heart icon top-right, then 4-5 lines of meta beneath including broker
  attribution.
- Editorial dropdowns (footer, language picker) are clean text columns over the white canvas - no
  card surface, no shadow.
- The design system caps elevation at one shadow tier
  (`box-shadow: rgba(0,0,0,0.02) 0 0 0 1px, rgba(0,0,0,0.04) 0 2px 6px, rgba(0,0,0,0.1) 0 4px 8px`) -
  used on hover-floated cards and search/account dropdowns.
- 8px base spacing system, with major sections at `{spacing.section}` (64px) - generous but not airy
  enough to feel editorial-magazine; the marketplace density wants more cards per scroll.

## Colors

### Brand & Accent

- **Coral Red** (`{colors.primary}` - #ff385c): The single brand color. Used for primary CTA
  backgrounds (Contact Agent, Continue), the search orb, the heart save state on listing cards, and
  inline brand links.
- **Coral Active** (`{colors.primary-active}` - #e00b41): The press / pointer-down variant -
  slightly more saturated. Used on `{component.button-primary-active}`.
- **Coral Disabled** (`{colors.primary-disabled}` - #ffd1da): A pale tint used on disabled CTAs.
- **Premium Purple** (`{colors.accent-deep}` - #460479): Sub-brand accent for premium. Only appears
  inside Premium-branded surfaces - never in mainline marketing.
- **Select Magenta** (`{colors.accent-rich}` - #92174d): Sub-brand accent for select. Same scoping
  as Premium - sub-product only.

### Surface

- **Canvas** (`{colors.canvas}` - #ffffff): The default page floor for every public page. This style
  intentionally avoids dark mode in the public web shell.
- **Surface Soft** (`{colors.surface-soft}` - #f7f7f7): The lightest fill - used on disabled fields,
  sub-nav hover backgrounds, the inline search filter band, and a listing card's courtesy line. On
  the search bar it appears at 60% as the segment _hover_ wash only - the focused segment is a step
  darker, see below.
- **Surface Strong** (`{colors.surface-strong}` - #f2f2f2): Slightly heavier fill - circular
  icon-button surface (e.g., the breadcrumb back-arrow and listing toolbar buttons), and the search
  surface's two highlight states: the focused segment of `{component.search-bar-pill}` and the
  hovered row inside `{component.search-dropdown}`. Pairing it with Surface Soft as the hover wash
  is what keeps hover and focus distinguishable; the two tones are one step apart by design.

### Hairlines & Borders

- **Hairline** (`{colors.hairline}` - #dddddd): The default 1px border tone - search bar dividers,
  table separators, footer column splitters, card 1px borders.
- **Hairline Soft** (`{colors.hairline-soft}` - #ebebeb): A lighter divider used on long-scrolling
  editorial body separators. A stroke tone only - never a surface fill. Use `{colors.surface-soft}`
  for highlights.
- **Border Strong** (`{colors.border-strong}` - #c1c1c1): A heavier stroke used on disabled outline
  buttons and form input outlines after focus - including the search dropdown's own input
  (`{component.search-field-input}`), which takes this on focus rather than a brand tint.

### Text

- **Ink** (`{colors.ink}` - #222222): The dominant text color on light surfaces. Display headlines,
  body paragraphs, primary nav links, and most inline link text. Never pure black.
- **Body** (`{colors.body}` - #3f3f3f): A secondary running-text color used inside long-form review
  and amenity copy where ink would feel too heavy.
- **Muted** (`{colors.muted}` - #6a6a6a): Sub-titles inside neighborhood link blocks ("Homes for
  sale", "Condos for rent"), inactive product-tab labels, footer category sub-labels, "View all"
  links.
- **Muted Soft** (`{colors.muted-soft}` - #929292): Disabled link text. Used very sparingly.
- **Star Rating** (`{colors.star-rating}` - #222222): The same ink token - the star icon and "4.81"
  rating numbers all render in ink rather than a yellow/gold color, which is a deliberate brand
  choice (yellow stars read as cheap next to a trust-sensitive purchase).
- **On Primary** (`{colors.on-primary}` - #ffffff): White text on Coral Red CTAs.

### Semantic

- **Error** (`{colors.primary-error-text}` - #c13515): Inline error text for form validation.
  Distinct from Coral Red - slightly darker, more saturated red.
- **Error Hover** (`{colors.primary-error-text-hover}` - #b32505): Darkens on link hover.
- **Legal Link Blue** (`{colors.legal-link}` - #428bff): Inline links inside legal copy (Privacy,
  Terms). Only used inside the legal sub-band.

### Scrim

- **Scrim** (`{colors.scrim}` - #000000 at 50% opacity): The global modal backdrop tone - date
  picker, login dialog, language picker. Stored as the base hex; opacity is applied at render time.

## Typography

### Font Family

The system runs **Manrope Variable** for everything - display, body, navigation, captions,
microcopy. Fallbacks walk
`Inter Variable, -apple-system, system-ui, Roboto, "Helvetica Neue", sans-serif`. **Inter Variable**
is the historic in-house typeface still kept as the first non-variable fallback; system stacks back
it up.

There is no separate display family. The variable font carries the entire scale.

### Hierarchy

| Token                         | Size | Weight | Line Height | Letter Spacing     | Use                                                                         |
| ----------------------------- | ---- | ------ | ----------- | ------------------ | --------------------------------------------------------------------------- |
| `{typography.rating-display}` | 64px | 700    | 1.1         | -1px               | Provider profile rating display ("4.81")                                    |
| `{typography.display-xl}`     | 28px | 700    | 1.43        | 0                  | Reserved for large editorial/marketing headlines - not used on the homepage |
| `{typography.display-lg}`     | 22px | 500    | 1.18        | -0.44px            | Listing detail h1 (property address + headline)                             |
| `{typography.display-md}`     | 21px | 700    | 1.43        | 0                  | Section heads inside listing detail ("What this home offers")               |
| `{typography.display-sm}`     | 20px | 600    | 1.20        | -0.18px            | Sub-section titles ("Things to know")                                       |
| `{typography.title-md}`       | 16px | 600    | 1.25        | 0                  | Neighborhood link block titles ("Bethesda", "Arlington")                    |
| `{typography.title-sm}`       | 16px | 500    | 1.25        | 0                  | Footer column heads ("Support", "Business", "Company")                      |
| `{typography.body-md}`        | 16px | 400    | 1.5         | 0                  | Default running-text inside listing copy                                    |
| `{typography.body-sm}`        | 14px | 400    | 1.43        | 0                  | Card meta lines, dates, prices, distance text                               |
| `{typography.caption}`        | 14px | 500    | 1.29        | 0                  | Search field segment labels ("Location", "Price", "Home Type", "Intent")    |
| `{typography.caption-sm}`     | 13px | 400    | 1.23        | 0                  | Footer legal line ("© 2026 Cribstop.com \| Brokered by Real Broker, LLC")  |
| `{typography.badge}`          | 11px | 600    | 1.18        | 0                  | "Just Listed" / "Verified" floating badge text                              |
| `{typography.micro-label}`    | 12px | 700    | 1.33        | 0                  | Card amenity micro-labels ("Inline 6")                                      |
| `{typography.uppercase-tag}`  | 8px  | 700    | 1.25        | 0.32px (uppercase) | "NEW" badge on product nav tabs                                             |
| `{typography.button-md}`      | 16px | 500    | 1.25        | 0                  | Primary CTA button labels                                                   |
| `{typography.button-sm}`      | 14px | 500    | 1.29        | 0                  | Pill button labels (category strip)                                         |
| `{typography.link}`           | 14px | 400    | 1.43        | 0                  | Inline body links                                                           |
| `{typography.nav-link}`       | 16px | 600    | 1.25        | 0                  | Top product-nav labels (Homes, Services, Connect)                           |

### Principles

Display weights stay modest across the system. The homepage has no h1 at all - photography and the
neighborhood-link grid carry visual hierarchy on their own. The listing-detail h1 at 22px / 500 is
quiet too; the listing photo banner does the work above it.

The single typographically loud moment in the entire system is the **rating display**
(`{typography.rating-display}` - 64px / 700) on provider profiles. That is the only place the system
trusts type alone to carry hierarchy - rating numbers are a peak trust signal, so they get the
loudest treatment.

### Note on Font Substitutes

If Manrope Variable is unavailable, **Inter** is the closest open-source substitute. Adjust display
headlines down by ~2% in line-height to match Manrope's slightly tighter cap height; otherwise the
proportions transfer cleanly.

## Layout

### Spacing System

- **Base unit:** 4px (with 2px micro-step).
- **Tokens:** `{spacing.xxs}` 2px · `{spacing.xs}` 4px · `{spacing.sm}` 8px · `{spacing.md}` 12px ·
  `{spacing.base}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px ·
  `{spacing.section}` 64px.
- **Section padding (vertical):** `{spacing.section}` (64px) for major page bands; tighter than
  typical SaaS marketing (80-96px) because marketplace pages need higher card density per scroll.
- **Card internal padding:** `{spacing.lg}` (24px) for `{component.inquiry-card}` and
  `{component.booking-flow-card}`; `{spacing.base}` (16px) for listing-card meta block;
  `{spacing.sm}` (8px) for caption / date-row gutters.
- **Gutters:** `{spacing.base}` (16px) between cards in the homepage neighborhood grid;
  `{spacing.lg}` (24px) inside footer column gutters; `{spacing.xs}` (4px) on dense category-strip
  dividers.

### Grid & Container

- **Max content width:** ~1280px centered on the homepage and editorial pages. Listing detail pages
  cap closer to 1080px to keep the photo banner and inquiry rail readable.
- **Neighborhood link grid (homepage footer):** 6-column grid at desktop with each cell housing a
  neighborhood name in `{typography.title-md}` and a category sub-label in `{typography.body-sm}`
  muted.
- **Listing detail:** 2-column with photo / amenity body on the left (~64% width) and a sticky
  inquiry card (`{component.inquiry-card}`) on the right (~32%).
- **Footer:** 3-column link list (Support / Business / Company) at desktop, collapsing to 1-column
  on mobile.

### Whitespace Philosophy

The system gives editorial bands 64px of vertical breathing room but compresses card grids - listing
and neighborhood-link cards sit just 16px apart. The contrast is intentional: the page reads as
"open at the top, dense marketplace below," reinforcing the marketplace nature without overwhelming
the visitor at the fold.

## Elevation

The system has essentially **one shadow tier** plus the flat baseline.

- **Flat (no shadow):** Body, footer, all editorial bands - 95% of surfaces.
- **Card hover float:**
  `box-shadow: rgba(0, 0, 0, 0.02) 0 0 0 1px, rgba(0, 0, 0, 0.04) 0 2px 6px 0, rgba(0, 0, 0, 0.1) 0 4px 8px 0` -
  applied to listing cards on pointer hover, the search bar at rest, and the dropdown menus (account
  menu, language picker, date picker). This is the single shadow definition in the entire system.
- **Modal scrim:** `{colors.scrim}` rendered at 50% opacity - the global modal backdrop. Used on
  date pickers, login dialogs, language picker.

There are no progressive elevation tiers - the system either has the one shadow or none. Depth comes
from photography, the white-on-white surface separation, and rounded-corner clipping rather than
from layered shadows.

## Components

### Buttons

**`button-primary`** - Coral Red fill, white text, 8px radius, 14x24px padding, 48px height,
weight 500. The most common CTA across the system: "Contact Agent", "Continue", "Search",
account-flow primaries.

**`button-primary-active`** - The press state. Background flips to `{colors.primary-active}`. No
transform, no shadow change.

**`button-primary-disabled`** - Pale Coral Red tint at #ffd1da with white text. Cursor not-allowed.

**`button-secondary`** - White fill with ink text and a 1px ink outline. 8px radius. Used for
"Save", "Cancel", and inverse CTAs over Coral Red surfaces.

**`button-tertiary-text`** - Plain ink text, no surface, no border. Underlined on hover. Used for
"Show more" type links and modal close labels.

**`button-pill-primary`** - A pill-shaped coral CTA used on featured cells (e.g., "Register your
business" sub-CTA) - 9999px radius, 10x20px padding, 14px label.

### Search Surface

**`search-bar-pill`** - The signature contextual search bar, one variant per tab
(`{component.search-bar-homes}` / `{component.search-bar-services}` /
`{component.search-bar-connect}`). White fill, 9999px radius, 64px height, 1px hairline 1px-shadow
border. Internally divided by vertical hairline rules into `{component.search-field-segment}` cells
— Homes: Location / Price / Home Type / Intent (three cells as built: Where / When / What, the
location cell taking 40% of the bar below `lg` and half of it above). Each segment holds an
uppercase caption label above a placeholder line in `{typography.caption}`. The bar keeps its white
fill in every state: focus is carried by the open segment alone, which takes a
`{colors.surface-strong}` (#f2f2f2) fill inset 1px inside the border, sliding between segments as
focus moves. Segment hover is `{colors.surface-soft}` at 60% (≈#fafafa), so ground → hover → focus
reads as one deepening scale, and the hairline rules flanking the focused segment drop out.

The fill sits at #f2f2f2 for a reason, having been wrong in both directions:
`{colors.hairline-soft}` (#ebebeb) is a stroke tone and as a fill reads as a pressed button, while
`{colors.surface-soft}` (#f7f7f7) is so close to the hover wash that the two states became
indistinguishable. #f2f2f2 is the only step that leaves both gaps legible.

**`search-dropdown`** - The panel that hangs off an open segment, 6px below the bar and flush with
its left and right edges. `{rounded.xl}` (32px) - the most rounded surface in the system after a
full pill, which is what keeps it reading as part of the search bar rather than a generic menu -
plus a 1px `{colors.hairline}` border and the system's single shadow tier. All three segment panels
(Where / When / What) share these exactly; the date panel used to carry a bespoke
`0 4px 24px rgba(0,0,0,0.13)` shadow and a 16px radius, which is the kind of drift this entry exists
to prevent.

There is no occupancy ("Who") segment. It was removed in full, not hidden: on a housing search an
age-band and children/infants occupancy picker collects familial status, age and family
responsibilities, and its pets counter was labelled "Bringing a service animal?", which adds
disability — four protected classes in one panel. Recorded decision on #34, 2026-08-13. Nothing in
Homes prices on occupancy, so the cost was a control, not a capability; do not reintroduce one.

**`search-field-input`** - The rounded input inside an open segment's dropdown. Deliberately
indistinguishable from the bar itself: white fill, `{rounded.full}`, 1px `{colors.hairline}` border,
and **no shadow of its own** — the dropdown it sits in already carries the system's single shadow
tier, and stacking another would break the no-progressive-elevation rule above. On focus the border
goes to `{colors.border-strong}` (#c1c1c1) with a matching 1px ring; it is never a coral ring, since
brand coral is reserved for CTAs and `{component.search-orb}`.

**`search-orb`** - The circular coral orb terminating the right edge of the search bar. 48x48px,
fully rounded, white magnifying-glass icon centered. The hottest single color moment on the
homepage.

### Top Navigation

**`top-nav`** - White surface, 80px height, 1px bottom hairline. The brokerage + Cribstop wordmark
sits flush left, the three product tabs (Homes / Services / Connect) sit in the dead center, and
account utilities (waffle apps panel, notification bell, account menu) sit flush right. One account
carries all roles — consumer browsing, provider dashboard, and landlord management are entry points
in the same nav, never separate logins or locked modes.

**`product-tab-active`** - Ink label in `{typography.nav-link}`, 32px hand-illustrated icon, 2px ink
underline rule beneath the icon-label pair.

**`product-tab-inactive`** - Muted label, illustrated icon, no underline. Becomes active on click.

**`new-tag`** - A tiny rounded-pill badge (`{rounded.full}`) anchored top-right of an icon, carrying
the uppercase "NEW" label in `{typography.uppercase-tag}` (8px / 700 with 0.32px tracking,
uppercase). Used on Services and Connect to signal recency.

### Listing Cards

**`listing-card`** - A photo-first card. 1:1 aspect-ratio image with `{rounded.md}` corner clipping,
image carousel dots overlay, `{component.listing-badge}` floating top-left ("Just Listed" / "Price
Reduced" / "Open House" / "New Construction"), and a heart icon top-right
(`{component.icon-button-circle}` in default outlined state, Coral Red-filled when saved). Beneath
the image: 4-5 lines of meta - price (`{typography.title-md}`), address/neighborhood and
beds/baths/sqft (`{typography.body-sm}` muted), and the required broker attribution line
(`{component.broker-attribution-bar}`).

**`listing-card-photo`** - The photo plate itself, separated as a token because some surfaces (saved
homes, search results) reuse just the photo without the meta block.

**`provider-card`** - A taller-aspect card (4:5) for Services provider listings. Same `{rounded.md}`
clipping, floating category-scoped Verified badge, heart top-right, and provider name / category /
rating meta beneath. Mentor-available providers additionally carry `{component.mentor-badge}`.

**`listing-badge`** - White rounded pill (`{rounded.full}`) at 11px / 600 weight. Sits over the
photo with the system's only shadow tier applied for elevation.

### Listing Detail & Provider Profile

**`rating-display-card`** - The signature provider-profile moment. A 64px / 700 rating number
("4.81") flanked left and right by tiny laurel-wreath SVG ornaments. Beneath the rating: "Top rated"
tagline and a row of ink stat columns (completed jobs, response time). The largest typographic
weight in the whole system.

**`amenity-row`** - A 1-column list of amenity icons + ink labels in `{typography.body-md}`. 12px
row padding, no border between rows; section is closed by a 1px hairline divider above and below.

**`reviews-card`** - A 2-column grid of review excerpts. Each column holds an author row (avatar,
name, date) above a 3-line excerpt with "Show more" tertiary link.

**`provider-profile-header`** - A white card with `{rounded.md}` rounding and 24px padding holding
the provider avatar, name, business name, category-scoped Verified badge (and
`{component.mentor-badge}` where opted in), response-time stat, and a "Message"
`{component.button-secondary}`.

**`inquiry-card`** - The sticky right-rail card on listing detail pages. White surface,
`{rounded.md}` rounding, 1px hairline border, 1px shadow tier elevation, 24px padding. Contains:
listing price (`{typography.display-md}` ink), `{component.mortgage-teaser}` (estimated monthly
payment), and full-width CTAs — "Contact Agent" primary, "Schedule Tour" / "Request Info" secondary
— above the broker attribution in `{typography.body-sm}`.

### Date Picker

**`date-picker-day`** - A 40x40px circular cell carrying the day number in `{typography.body-sm}`.
Default state is transparent fill, ink text.

**`date-picker-day-selected`** - Ink fill, white text, full circle (`{rounded.full}`). Range states
between two selected days carry a `{colors.surface-soft}` lozenge background that connects them.

### Forms

**`text-input`** - White surface, 1px hairline outline, `{rounded.sm}` 8px radius, 56px height,
14x12px padding. Stacked label above (in `{typography.caption}` muted), placeholder text in
`{typography.body-md}` muted. On focus, the border thickens to 2px ink and the border color flips to
`{colors.ink}` - no glow, no ring.

### Footer

**`footer-light`** - White surface (matches the page canvas - the platform has no contrast footer),
48x80px padding. Three columns of link blocks (Support / Business / Company), separated by generous
24px gutters. Each column heads with a `{typography.title-sm}` ink label and stacks
`{component.footer-link}` rows in `{typography.body-sm}` ink.

**`legal-band`** - A bottom strip beneath the footer columns carrying the compliance line ("© 2026
Cribstop.com | Brokered by Real Broker, LLC | MD · DC · VA | Equal Housing Opportunity"), language
picker (globe icon + "English (US)" link), and social icons. All text in muted `{colors.muted}` at
`{typography.caption-sm}`.

## Responsive Behavior

| Name    | Width       | Key Changes                                                                                                                                                                                                                                  |
| ------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile  | < 744px     | Top nav collapses to logo + hamburger; product tabs hide behind a sheet; search bar collapses to a single tappable pill; listing cards stack 1-up; neighborhood grid 1-column; listing detail collapses inquiry card to a sticky bottom bar. |
| Tablet  | 744-1128px  | Top nav keeps product tabs but search bar narrows; listing cards 2-up; neighborhood grid 2-3 column; inquiry card stays sticky right-rail at narrower width.                                                                                 |
| Desktop | 1128-1440px | Full top nav with three product tabs centered; search bar at full pill width with all 3 Homes segments visible; listing cards 4-up; neighborhood grid 6-column; listing detail 2-column with inquiry rail.                                   |
| Wide    | > 1440px    | Content width caps at 1440px on listing/search pages and ~1280px on editorial; gutters absorb the rest.                                                                                                                                      |

### Touch Targets

- Primary CTAs at minimum 48x48px (above WCAG AAA).
- Search orb is 48x48px circular - the most-tapped element on the page.
- Heart save button is 32x32px circular - borderline for AAA but compensated by a generous 12px
  padding inside the photo card.
- Date-picker day cells are 40x40px circular.

### Collapsing Strategy

- Top product tabs collapse into a hamburger sheet below 744px.
- Search bar segments collapse into a single-tap entry that opens a full-screen search overlay on
  mobile.
- Listing and neighborhood-link grids drop column counts cleanly at each breakpoint - never reflow
  rows; always reduce columns.
- Inquiry card on listing detail switches from sticky right-rail to a sticky bottom bar on mobile,
  carrying just the "Contact Agent" CTA + price summary.

## Known Gaps

- **Hover state colors:** intentionally not documented per the global no-hover policy - the
  platform's actual `:hover` styling for listing cards is a subtle elevation lift, but precise
  extraction is unreliable. The one exception is the search surface
  (`{component.search-field-segment}`, and the hovered row in `{component.search-dropdown}`): those
  tones are ours rather than extracted, so they are specified rather than left as a gap. They use
  two different steps - Surface Soft at 60% for hover, Surface Strong for focus - because a single
  tone serving both left them ~1% apart in luminance and effectively identical.
- **Loading states / skeleton screens:** not visible on the extracted surfaces.
- **Map view styling:** the search-results map uses third-party tiled maps with custom coral
  markers; not captured here.
- **Form input error states:** error text color (`{colors.primary-error-text}`) is documented, but
  the full input outline + helper-text combination on validation failure was not visible in the
  captured surfaces.
- **Sub-brand palettes:** Premium (`{colors.accent-deep}`) and Select (`{colors.accent-rich}`) are
  documented as tokens, but their full sub-system (typography overrides, surface treatment) lives on
  separate sub-domains and is not captured here.
