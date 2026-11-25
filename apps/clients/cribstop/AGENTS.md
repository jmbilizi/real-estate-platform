# Cribstop Web App (cribstop-web)

Next.js (App Router) consumer app at `next/` — the three-tab experience: Homes, Services, Connect.
Nx project name: **`cribstop-web`**.

## Commands

```bash
pnpm run cribstop:web                  # Dev server with HMR
pnpm run skaffold:services             # Run backend in K8s alongside (2nd terminal)
pnpm exec nx lint cribstop-web        # Also: test, type-check
pnpm run test:clock-guard              # Specs with the system clock one year ahead
```

`cribstop:web` runs the app's `dev` script directly, not through Nx. It needs only Node and pnpm,
not the .NET SDK.

A spec that renders a relative or clock-dependent value pins the clock with `pinClock()` from
`src/test/fixed-clock.ts`. It asserts the exact text. Run `test:clock-guard` before you add a spec
with a fixed date. A failure means a spec reads the real clock.

## Key Docs

- `DESIGN.md` (this directory) — design system: tokens, typography, components.
- `PRD.md` (repo root) — §4 information architecture, §6 compliance.

## Structure Notes

- Route groups in `next/src/app`: `(pill-only)`, `(tabs-only)`, `(with-search)` control
  navbar/search variants; `@modal` is a parallel route for modals.
- `next/src/lib/brand.ts` — centralized brand (PRD §6.1 brokerage identification); propagate brand
  changes from here only, never hardcode.
- `next/src/lib/types.ts` — **re-exports `@cribstop/property-contracts`; it does not declare listing
  shapes.** Add a field to the contract, never here. Search and detail are two different shapes:
  `ListingCardRow` (flat, what `GET /property/listings` returns) and `ListingDetailView` (the
  flattened form of the nested `{ property, unit, listing }` detail graph, produced by
  `toListingDetailView` in `lib/api/listings.ts`). Never force one to serve both.
- **Lean list, rich detail — the payload split is a design rule, not an accident.** A search or
  home-page request fetches only what a _card_ draws, `primaryMedia` alone rather than the gallery,
  because a results page renders ~20 rows and every added field is paid 20 times. The full graph
  (all media, description, open houses, complete NAR 7.58 attribution) is fetched only when a user
  opens a listing, which is when it is worth paying for. Consequences to respect: never widen
  `ListingCardRow` to spare a detail fetch, never render a card from a detail payload "because we
  have it", and never assume a card row carries a detail-only field — it is absent, not null.
  Opening the same listing twice should still cost one fetch: `lib/api/listings-cache.ts` is a
  per-tab, 5-minute detail cache that exists to make that true. It is **not** the platform's caching
  layer — service-side Redis caching on the Property API is, and is tracked separately; this only
  removes the round trip a warm server cache would still cost.
- `next/src/lib/contracts.check.ts` — a **type-only** conformance file against
  `@cribstop/property-contracts` (`libs/property-contracts`), the single definition of the listings
  wire contract. It emits no runtime code and touches no component. If a contract change breaks
  `pnpm exec nx type-check cribstop-web` here, reconcile the rendering code to the new contract
  rather than editing these assertions to match — the assertions are what caught the drift.
- `next/src/lib/listing-format.ts` — the **only** place a nullable listing field is turned into
  display text. Every compliance rule with a copy consequence lives here exactly once (withheld
  price, lot-size units, the no-bare-comma title fallback, the no-centroid address rule). Format at
  this layer, not at the render site.
- `next/src/app/api/account/*` and `next/src/app/api/listings/*` — **real backend** via the API
  gateway. Account is `/account/*`; listings are `/property/listings`, `/property/listings/meta`,
  `/property/listings/{id}`, `/property/listings/{id}/card` (the service serves `/listings/*`;
  Ocelot rewrites — never call the service path directly). The browser never talks to the gateway:
  it calls these route handlers, which make the hop server-side via `app/api/_lib/gateway.ts`. Do
  not break this wiring.
- `next/src/app/api/_lib/listings-query.ts` — the forwardable query-parameter set is **derived from
  the contract's `searchRequestSchema`**, never hand-listed. It is an allowlist on purpose: it is
  what makes "no occupancy value is ever transmitted" (#34) structural instead of a rule someone has
  to remember. Do not replace it with a denylist and do not add a parameter the contract lacks.
- The app README's intro now states the real data flow; everything below it is the **original mockup
  spec kept for historical context** (it still says "static JSON only" and references
  `lib/listings.ts`, deleted in #24 — listing data comes from the Property API). Trust the code.

## Project Automations

- `/compliance-check` (skill, this project) — audit copy/mock data for Fair Housing,
  brand-prominence, fabricated-data, and disclosure rules before shipping.
- `cribstop-compliance-reviewer` (root agent) — dispatchable parallel compliance review for PR diffs
  touching user-facing content.

## Home page reads (#755)

- Each home row fetches its own cards with `skipTotal: true`. `total` is the number of cards the row
  got, which is all a row reads. One failing row shows its own retry card and no other row changes.
- `/api/listings` with `skipTotal=true` (the home rows), `/api/listings/meta` and
  `/api/listings/neighborhoods` use the server cache in `app/api/_lib/read-cache.ts`. It holds 500
  reads, least recently used out first, and no body over 512 KB. The lifetime of an entry is the
  Property API's own `Cache-Control`: `s-maxage` when present, else `max-age`. That is **60 seconds
  for listing rows** and **300 seconds for meta and neighborhoods**. A listing that goes off market
  or is suppressed leaves a row within that time. An error and a `no-store` or `private` response
  are never stored. Never raise a lifetime here. Change the upstream header instead.
- The proxy retries a gateway 502, 503 or 504 once, and sends the visitor IP as `X-Forwarded-For`.
  The gateway rate-limits on that address. Without it, every visitor shares the one bucket of this
  pod.

## Server data (#897)

- Use TanStack Query for client-side server data. `QueryProvider` in `layout.tsx` supplies one
  client. Defaults live in `src/lib/query/query-client.ts`.
- Each domain owns one key factory and its `queryOptions` in `src/lib/query/`. See `keys.ts`. Never
  write a key inline.
- Pass the `signal` from `queryFn` to the `lib/api` call.
- Never prefetch per-user data on an ISR page. The cached HTML would show one user's data to all.
- The home page stays ISR (#871). Do not add `force-dynamic` to it.
- In a spec, render with `renderWithClient` from `src/test/renderWithClient.tsx`. It makes a new
  client for each call, with no retries.
- Saved homes (#901) live in the Query cache under `['saved-homes']`, not in Redux. Toggle them only
  through `useToggleSaved`. Its `scope` runs toggles in order. Never persist this cache. A logout
  clears it through `AccountQuerySync`.

## Rules

- Airbnb-quality polish; mobile-first; accessible (labels, alt text, focus states, semantic HTML).
- **Mobile first (stakeholder rule, 2026-09-27).** Verify every new or changed UI at 360px and
  390px, before a PR. Check: no sideways body scroll, tap targets at least 44px, text stays readable
  with no clipping, and any card row scrolls horizontally by touch.
  - A tap target's 44px hit area does not have to match its visual size (#423). A small visual
    control — a ~32px icon chip or circle — can sit inside a larger invisible hit area (padding, or
    a `min-h-11`/`min-w-11` wrapper) so the control reads lighter without shrinking below 44px of
    actually-tappable space.
- All listing/marketing microcopy must be Fair-Housing compliant and attribute Real Broker, LLC
  legibly (PRD §6.1). The header brand is `BrandMark`: a small square in the brand color with a
  handwritten "CS", the same at every width, with no brand text in the header (stakeholder decision
  2026-11-24, which replaces the `BrandLockup` text of #1048). The brokerage rule is about relative
  prominence: the Cribstop name must never show more prominently than "Real Broker, LLC"
  (stakeholder ruling 2026-11-24). It does not require the brokerage name at the top of each page.
  The header shows neither name, so the rule holds. Wherever the Cribstop name shows as text, the
  brokerage name shows with it, at least as legible. The link name of the mark holds "Cribstop at
  Real Broker, LLC", and the visible brokerage name is in the footer. `BrandLockup.tsx` stays in the
  repo.
- Follow existing component patterns and Tailwind config; no new dependencies unless clearly
  necessary.
- **Listing cards are one height in any grid or carousel (#1048).** Never add a row to the info
  block for one listing only. A price change is the photo badge ("Price cut $50K"), never a line
  under the price and never a date. Sample and Sponsored labels sit on the photo, bottom left. The
  "Price reduced" pill shows only when the card has no amount, so one fact shows once.
- **A home row never repeats a card an earlier row shows (#873, #1048).** The Coming Soon rows drop
  every repeat (`minCards: 0`) and hide when nothing is left.
- **Header and content share one gutter: `.page-gutter`** (`px-4 sm:px-6 lg:px-8`: 16px on a phone,
  24px from `sm`, 32px from `lg`). The header, each home row, the footer, the search page and the
  listing detail page use it at every width. Never write the three paddings by hand. Two values
  follow it: the carousel bleed (`-mr-4` in `CarouselShell`) and the in-page search bar width
  (`DOCK_LARGE_CLASS`).
- **The header is one row at every width, and nothing in it moves on scroll (2026-11-24).** From
  `md`: brand mark and search pill on the left, then primary tabs, Account and More on the right.
  The row has no Saved button: a signed-in user has "Saved" in the account panel, and a phone has
  Saved in the tab bar. Account has the shape of a tab: the account icon, then "Sign in" (signed
  out, opens the sign-in dialog) or the first name (signed in, opens the account panel), with the
  label from `lg`. On a phone: brand mark, search pill and Account, with the tabs in the bottom bar.
  The phone pill (`MobileSearchPill`) has the same one-line shape as the desktop field. The search
  bar rests as the pill on every page: one line, with the "Where" label as the placeholder and no
  label line. A click opens it in its place: the pill grows to the right (a CSS width transition on
  `.header-search-dock`), the location field becomes a text input in the bar, and the panel of the
  clicked field opens below with a scrim behind it. An outside click, Escape or a completed search
  closes the panel, and the bar shrinks back. On a phone the pill opens the full-screen sheet. There
  is no in-page search row.
  - **The search bar and its panels share one geometry.** The pill, the open bar and each panel have
    a 1px border, so nothing moves by 1px when the bar opens. A panel row has the insets of the bar
    (`px-4`, `gap-2.5`, a 20px icon), so its icon and text sit under the icon and text of the bar.
    The "Where" panel has the width of the bar. The "What" panel is 352px wide, under the "What"
    field at the right. The phone pill and the phone sheet use the same 16px inset.
  - Account is a nav item. On `/account` and every page below it (`isAccountPath` in `NavBar.tsx`)
    it is the active item and no tab is. It gets the tab underline from `md`, and the brand color on
    a phone.
  - **Account activity pages live below `/account`, never on the feed.** `/account/favorites`
    (Saved) and `/account/recently-viewed` each have one section for Homes, Services and Connect
    (`ActivitySection`). A product with no activity yet shows `ActivityNotYet`, with no link and no
    button. The account panel and "Your activity" on `/account` link to both pages. `/favorites`
    redirects to `/account/favorites` (`next.config.js`). The home feed has no "Recently viewed"
    row.
  - **The listing detail has no boxed sections (2026-11-24).** The body is white. Each section is
    flat with a hairline under it. The gallery is edge to edge on a phone and has round corners from
    `sm`. The sidebar blocks (agent, open houses, payment estimate) are cards from `lg` only, with a
    soft shadow and no border. The loaded page and `ListingDetailSkeleton` both take their classes
    from `components/listing/detail-layout.ts`. Never add a bordered or tinted panel to this page.
  - **Cards get width before count.** A carousel shows 4 items from `md`, 5 from `xl`, 6 from `2xl`
    and 7 from `3xl` (1920px) (`CAROUSEL_ITEM_WIDTH_CLASS`). A laptop shows 6. The search grid has
    two columns at most (`RESULTS_GRID_COLUMNS_CLASS`). The card address is one line, never two.
    `.listing-card-address` sets its size from the card width: 11, 12 or 13px.
  - The tabs come from `PRIMARY_TABS` (`MobileTabBar.tsx`): one list and one icon set for the phone
    bar and the desktop header. They show icons from `md` and icon with label from `lg`.
  - The pill is fixed over `NavBar`'s `.header-pill-slot`. Both read `--header-pill-left` and
    `--header-pill-w` (globals.css). Change the variables together with the row.
  - One destination shows once. The header does not mount the Apps grid. "List a property" and
    "Business directory" are in the More menu, which is also the phone Settings sheet.
    `AppsDropdown.tsx` and `NavTabIcons.tsx` stay in the repo for possible later use (stakeholder
    decision, 2026-11-24). Do not delete them as dead code.
- **Text and icons use the mobile sizes at every width (stakeholder rule, 2026-11-24).** The face is
  the platform UI font (`SYSTEM_FONT` in `tailwind.config.ts`), with no web font. This replaces the
  Manrope note in `DESIGN.md`. The scale is 11, 12, 13, 14, 15, 16, 17 (`text-lg`), 20 (`text-xl`),
  22 (`text-2xl`) and 28px (`text-3xl`, a page title). Never add a breakpoint step that makes text
  larger on a wide screen, and never use a weight above `font-bold`. A field is 16px on a touch
  device, so iOS does not zoom on focus. Icons are 16px beside text, 20px for an action and 24px in
  a bar. The header tab pictures are 28px.
- **A selected control is the brand color, never a black fill (2026-11-24).** A selected chip or
  tile is `border-brand bg-brand-50 text-brand-700`. A primary action is `btn-primary`. An error is
  `text-brand-700`. Icons are `lucide-react` line icons, never emoji. The filter panel
  (`FilterModalContent.tsx`) holds the pattern. The account page sections share
  `components/account-card.ts`.
- **The full-screen photo viewer (`PhotoViewer` in `PropertyGallery.tsx`, 2026-11-24).** White
  ground. The photo fills a frame with the blurred-photo fill, so no empty space shows. Previous and
  Next are white circles at mid height on the photo sides, never at the bottom left, where the
  Bright MLS watermark is. A filmstrip below opens any slide. A sideways swipe changes the slide.
- **A fieldset never carries a divider or section padding.** A legend sits on the top border of its
  fieldset. Put the border and the padding on a wrapper `div`.
- **The market time shows once, in the gallery status badge.** Never add it under the price.
- **One fact shows once on a page.** The home trust block states the freshness in its title and the
  brokerage with its states in one sentence. Do not add an eyebrow or a stat tile that repeats them.
- **Never collect a protected-class signal from the searcher.** The occupancy ("Who") picker was
  removed in #34 (age bands, plus a pets counter labelled "Bringing a service animal?" — age,
  familial status, family responsibilities and disability). Do not reintroduce any of it. The
  `Pet Friendly` **listing** amenity is a listing attribute and is fine; a question about the
  searcher is not.
- **Per-listing compliance is driven off the row, never off a flag.** Provenance follows that row's
  `source` (`brightMLS` → Bright's line, `internal` → ours, `other` → neither) — never a build flag,
  env var or default. `isSample` must be labelled on every surface a sample row appears on (card,
  map popup, detail, modal, carousels), and `sponsored` must be labelled wherever it renders.
  **Exception (#305, stakeholder ruling 2026-09-22):** card surfaces (search card, map popup) render
  one line, "Listing courtesy of {officeName}", for every `source`, including `brightMLS`. The
  detail page still branches on `source`. Human-action ticket #306 tracks confirming this exception
  with Real Broker LLC and Bright MLS before a live Bright row ships.
- **Site-level** Bright/MLS wording in `Footer.tsx` and `app/(pill-only)/about/page.tsx` is a
  separate matter from per-listing provenance: removing MLS attribution can itself violate IDX
  display rules. That wording is #33's to deliver with broker sign-off — flag it, do not invent
  replacement copy.
- A withheld (`null`) `price` renders "Price withheld at the seller's direction" — never blank,
  never `$0`, never an estimate. A suppressed address (`address`/`latitude`/`longitude` null
  together) renders no address and **never** a city or ZIP centroid; the map legitimately shows
  fewer pins than the result count, and that is explained in copy rather than hidden.
- The search map draws every home as a small red teardrop pin on one canvas (`PricePinLayer.tsx`,
  `lib/pin-draw.ts`, `lib/map-pins.ts`, #549, #557). There are no dots and no DOM markers: 1,800 DOM
  markers dropped frames at 4x CPU. A pin shows no price at rest. A hovered home, a hovered listing
  card, and the home with an open popup show the red price pill instead. A device with no hover
  shows the pill only for the open popup. Pins overlap freely. Homes at one true coordinate fan out
  only at zoom 17 or higher. Any click on a pin opens `MapPinCard`: the page row, or the card from
  `GET /listings/{id}/card`.
- The basemap is OpenFreeMap vector tiles (`liberty` style) drawn by `maplibre-gl` inside the
  Leaflet maps through `BasemapLayer.tsx` (#296). It needs no key and no account, and its terms
  allow commercial use. The attribution text is required (OpenFreeMap, OpenMapTiles, OpenStreetMap
  contributors): keep it in `lib/map-providers.ts`. `MAPTILER_API_KEY` is an optional override. When
  set, `/api/map-config` returns MapTiler raster tiles. OpenFreeMap is a donation-funded public
  service with no SLA. The exit path is a self-hosted PMTiles build. Never call
  `tile.openstreetmap.org`: its policy forbids this use. The CSP sets only `frame-src`, so tile and
  font hosts need no CSP entry.
- `next/scripts/check-legal-content.js` blocks the **prod** deploy while `src/content/legal/*.json`
  carries `isDraft: true` (#219). It runs only from the prod job in
  `.github/workflows/deploy-k8s-resources.yml`, keyed on `DEPLOYMENT_ENV=prod`. `DEPLOYMENT_ENV` is
  the canonical deployment-environment variable name #219 introduces for cross-ticket reuse (values:
  `local`, `dev`, `test`, `prod`); #245 wires it into a Kubernetes CronJob the same way.
  `is-production-build.js` is a separate, unrelated signal: it only toggles Next.js standalone
  output and must not be reused for environment checks (#157).
- **`tools/dev/cribstop-web.js` launcher.** It runs the app's `dev` script. To use the deployed dev
  gateway, set `API_GATEWAY_URL` and `API_GATEWAY_BASIC_AUTH` in `next/.env.local`. Without them,
  the app calls the local gateway on `localhost:8080`. In a worktree with no `.env.local`, the
  launcher loads the primary checkout's file and logs only its key names.
  - The launcher also canonicalizes the workspace root casing with `fs.realpathSync.native` before
    it starts Next (#440). A shell cwd of `c:\...` and `C:\...` resolve to the same directory but
    are different strings, so an uncanonicalized cwd makes webpack load two copies of Next and React
    and crash every route with `invariant expected app router to be mounted`.
- **Home page section copy (stakeholder rule, 2026-09-27, #394/#416/#418).** Applies to every home
  page row (`HomePageContent.tsx` and any row it adds):
  - No subtitle by default. The title alone must say what the row shows.
  - A section title is a call to action: 3 to 7 words, a verb (See, Find, Explore, Search, Tour)
    plus what it shows.
  - Every title names its listing type, "for sale" or "rentals", so a visitor never has to guess.
  - Every count or place named in a title comes from the API or the visitor's own last search. Never
    invent one, and never derive one from IP/geolocation.
  - Banned in titles: "trending", "popular", "best", "hot", "exclusive", "selling fast", "first
    dibs", "priority access", "before anyone else", "dream", "perfect for", "ideal for", any
    demographic/audience/family word, "safe", and any savings or affordability claim.
  - The "Coming Soon" status word always stays visible on a Coming Soon row.
  - Never say "MLS" or "IDX" in consumer-facing copy — trade jargon, not a term a visitor uses.
  - A trust-block or brokerage claim states a fact about Cribstop or Real Broker LLC, never about
    the listings: the listings come from Bright MLS via IDX and belong to many brokerages, each
    already attributed on its own card (NAR IDX policy 7.58).
  - Title text: `text-xl font-semibold`, the same 20px at every width. Every row with a "see all"
    link carries the round arrow chip next to its title (`ListingRow`'s existing pattern).
  - On a phone (below `sm`), a carousel shows about two cards with the next one peeking in, native
    touch scroll (`scroll-snap-type: x mandatory`, no visible scrollbar), and no arrow buttons — the
    card row bleeds to the screen edge on the right while the first card still lines up under the
    title.

## Home feed rollout (#836)

- `HOME_FEED_ENABLED` (default `false`) and `HOME_FEED_ROLLOUT_PCT` (0 to 100) are server env vars.
  `GET /api/feed-config` serves them (`s-maxage=60`). The home page stays static, and the client
  reads the config, then buckets. Until it arrives, today's rows show. A visitor who scrolled past
  80 px or touched the page keeps today's rows.
- The bucket is `fnv1a("home-feed-v1" + anon id) mod 100`. A bucket below the percent gets the feed.
  No anon id (opt-out, GPC) gets today's rows.
- The feed shows only for a warm visit with a place from `explicit`, `last-search`, `looking-for`,
  `saved-home`, `viewed-homes` or `visit-views`. An IP or geolocation place never reaches a title.
- Flag off, control bucket, cold visit, an error, `variant: fallback` and an empty answer all render
  today's rows. Never show an error for the feed.
- Compare the arms on eligible visitors only. A treatment visitor with no feed also sees today's
  rows.
