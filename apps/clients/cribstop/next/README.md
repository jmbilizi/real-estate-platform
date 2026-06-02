# Cribstop Next.js

A high-fidelity **Next.js** mockup for a real estate marketplace called **Cribstop.com**, owned by
an agent from **Real Broker LLC**. The site feels like **Airbnb for real estate** — clean, modern,
premium, image-forward, and highly searchable — focused on buying, selling, and renting homes. It
uses **static JSON data** as the only data source; it does not connect to any backend, API, CMS, or
live MLS feed.

## Goal

Create a polished public-facing website mockup that demonstrates the end-user experience of
searching, browsing, saving, and viewing real estate listings. The experience is familiar to Airbnb
users: large hero search, category pills, elegant listing cards, responsive grid layout, saved
homes, and a detailed property page. The design is modern, trustworthy, spacious, and mobile-first.

## Brand

- Site name: **Cribstop.com**
- Brokerage/owner display: **Real Broker LLC** (licensed in MD, DC, and VA)
- Brand tone: modern, approachable, trustworthy, premium
- Visual direction: Airbnb-inspired marketplace UI, clearly for residential real estate

## Core Pages

1. **Homepage**
2. **Search results page**
3. **Listing details page**
4. **Favorites / saved homes page**
5. **Login / sign up / forgot password pages**
6. **About / compliance footer area**

## Authentication Experience

Full **user authentication UI** with:

- Login, sign up, and forgot password pages
- Email and password fields with "Remember me" checkbox
- Social sign-in buttons for Google and Apple (UI only)
- Profile avatar menu for signed-in users
- Saved homes and search alerts available only after login
- Polished modal or dedicated auth page layout matching the site brand

Authentication is **mocked only** — no real backend.

## Homepage Requirements

- Large hero section with a natural-language search bar ("Where do you want to live?") with
  location, price, home type, and rent/buy/sell toggle
- Airbnb-style category row: Homes for Sale, Homes for Rent, Open Houses, Luxury, New Construction,
  Condos, Townhomes, Investment Properties
- Featured listing cards with strong imagery, price, address/neighborhood, beds, baths, sqft, and
  listing broker attribution
- "Just listed," "Price reduced," and "Open house" badges
- Clean top navigation with logo, search, favorites, login, and profile menu
- Subtle map-preview or neighborhood-preview section
- Responsive layout for desktop and mobile

## Search and Browsing UX

Advanced filters:

- Buy / Rent / Sell
- Price range with slider and min/max inputs
- Beds, Baths, Property type, Square footage, Neighborhood
- Open house, New construction, Waterfront, Pet friendly
- Amenities: pool, garage, gym, elevator, balcony, fireplace, washer/dryer, pet friendly,
  waterfront, office, rooftop, garden

Sort controls: Recommended, Newest, Price low to high, Price high to low.

Each listing card shows: primary photo, price, address/neighborhood, bed/bath/sqft, property type,
**listing broker name** ("Listing courtesy of [Office]"), favorite heart icon, and badge chips for
amenities or status.

## Listing Detail Page

- Image gallery at top
- Large headline with price, address, property type, beds, baths, sqft
- **Broker attribution** shown clearly in agent sidebar card
- **Office broker lead phone and email** displayed in agent card if available
- Listing description and key facts / amenities grid
- Map section showing property location
- Similar homes section
- Mortgage / affordability teaser card
- Contact agent / schedule tour CTA
- Saved listing action
- **Per-listing compliance disclosure block** (see Compliance section below)

## Data Model

Mock listing data in `src/lib/listings.ts` with fields:

| Field                   | Type                                      | Notes                            |
| ----------------------- | ----------------------------------------- | -------------------------------- |
| `id`                    | `string`                                  |                                  |
| `title`                 | `string`                                  |                                  |
| `address`               | `string`                                  |                                  |
| `city`, `state`, `zip`  | `string`                                  |                                  |
| `neighborhood`          | `string`                                  |                                  |
| `price`                 | `number`                                  |                                  |
| `status`                | `Active\|Pending\|Sold`                   |                                  |
| `listingType`           | `sale\|rent\|sold`                        |                                  |
| `propertyType`          | `string`                                  |                                  |
| `beds`, `baths`, `sqft` | `number`                                  |                                  |
| `imageUrls`             | `string[]`                                |                                  |
| `brokerName`            | `string`                                  | Listing agent name               |
| `brokerPhone`           | `string`                                  | Listing agent phone              |
| `brokerEmail`           | `string`                                  | Listing agent email              |
| `officeName`            | `string`                                  | Office/brokerage name            |
| `officeBrokerLeadPhone` | `string` (optional)                       | Bright MLS OfficeBrokerLeadPhone |
| `officeBrokerLeadMail`  | `string` (optional)                       | Bright MLS OfficeBrokerLeadMail  |
| `lastUpdated`           | `string` (ISO 8601)                       | Used for dynamic footer date     |
| `description`           | `string`                                  |                                  |
| `amenities`             | `Amenity[]`                               |                                  |
| `latitude`, `longitude` | `number`                                  |                                  |
| `featured`              | `boolean`                                 |                                  |
| `openHouse`             | `{ date, startTime, endTime }` (optional) |                                  |
| `priceReduced`          | `boolean` (optional)                      |                                  |
| `newConstruction`       | `boolean` (optional)                      |                                  |
| `listedBy`              | `string`                                  | Display string for detail page   |

## Bright MLS IDX Compliance

This site complies with all Bright MLS IDX display requirements. The following disclosures are
implemented as described:

### Footer (every page — `src/components/Footer.tsx`)

| Requirement                                                                  | Implementation                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| IDX source disclosure — exact verbatim BRIGHT paragraph                      | Footer MLS Disclosure block                             |
| `Information Deemed Reliable But Not Guaranteed`                             | Footer MLS Disclosure block                             |
| Personal non-commercial use notification                                     | Footer MLS Disclosure block                             |
| Availability disclaimer — properties may no longer be available              | Footer MLS Disclosure block                             |
| IDX non-participation exclusion disclaimer                                   | Footer MLS Disclosure block                             |
| `Data last updated: [dynamic date]`                                          | Computed from highest `lastUpdated` across all listings |
| `© BRIGHT, All Rights Reserved` with clarification Bright is not the broker | Footer MLS Disclosure block                             |
| Brokerage name — **Real Broker LLC**                                         | Footer MLS Disclosure block                             |
| State(s) of licensure — MD, DC, VA                                           | Footer MLS Disclosure block                             |
| Equal Housing Opportunity link                                               | Footer bottom bar                                       |

### Listing Cards (every card — `src/components/ListingCard.tsx`)

| Requirement                                    | Implementation                                   |
| ---------------------------------------------- | ------------------------------------------------ |
| Listing broker name on every displayed listing | `"Listing courtesy of {officeName}"` below price |

### Listing Detail Page (`src/app/listing/[id]/page.tsx`)

| Requirement                     | Implementation                                                |
| ------------------------------- | ------------------------------------------------------------- |
| Broker attribution              | Agent card sidebar — brokerName, officeName                   |
| `OfficeBrokerLeadPhoneNumber`   | Agent card sidebar — rendered when present                    |
| `OfficeBrokerLeadMail`          | Agent card sidebar — rendered when present                    |
| Per-listing accuracy disclaimer | Listing disclosure block below description                    |
| `Data last updated` per listing | `formatDate(listing.lastUpdated)` in disclosure block         |
| Personal non-commercial use     | Listing disclosure block                                      |
| Availability disclaimer         | Listing disclosure block                                      |
| Listing courtesy attribution    | Listing disclosure block — "Listing courtesy of {officeName}" |

### Rules Not Triggered (conditional requirements)

- **Bright Monitoring Code** _(production requirement — cannot be mocked)_: Section 3j of the
  Digital Display Policy requires enabling Bright's usage tracking script on all digital displays
  within 60 days of written instruction from Bright. Bright provides this script when IDX access is
  granted. Add it to `src/app/layout.tsx` as a `<Script>` tag once received.
- **Bright IDX icon on photos**: Optional per Section 4d — the icon **may** be displayed alongside
  the listing firm name but is not required when the firm name is already shown. Our `ListingCard`
  shows the firm name on every card, satisfying the requirement without the icon.
- **Sold/closed listing disclaimers**: `listingType: 'sold'` exists in the type but no sold listings
  are displayed. If added, each must be labeled "Closed"/"Settled"/"Recent Sale" and two additional
  BRIGHT disclaimers must be included (appraisal disclaimer + compilation accuracy).
- **Automated valuation disclaimer**: No AVM feature exists. If added, it must not be called an
  "appraisal"; the sold-data disclaimers above also apply.
- **Comments/reviews or AVM on listing**: No third-party reviews displayed. If added, a seller
  opt-out mechanism must be implemented per IDX rules.

## Technical Requirements

- **Next.js App Router** with TypeScript
- **Tailwind CSS** with custom design tokens (`ink`, `surface`, `brand`)
- **Component-based architecture** with reusable components in `src/components/`
- **Mock JSON data only** — no backend, no auth service, no database, no external API calls
- Optimized for responsiveness and clean spacing
- Realistic placeholder images from Unsplash

## Project Structure

```
src/
  app/                  # Next.js App Router pages
    page.tsx            # Homepage
    search/             # Search results
    listing/[id]/       # Property detail
    favorites/          # Saved homes
    login/              # Auth pages
    signup/
    forgot-password/
    about/              # About + compliance info
  components/           # Reusable UI components
    Header.tsx
    Footer.tsx          # MLS compliance disclosures live here
    ListingCard.tsx     # Broker attribution on every card
    HeroSearch.tsx
    FilterPanel.tsx / FilterModal.tsx
    PropertyGallery.tsx
    MortgageTeaser.tsx
    AmenityChips.tsx
    ListingsMap.tsx / SingleListingMap.tsx
    AuthForm.tsx
    ...
  lib/
    listings.ts         # Mock listing data (all 12+ listings with officeBrokerLead fields)
    types.ts            # TypeScript types including Listing interface
    filters.ts          # Filter/sort logic
    format.ts           # Price, date, number formatters
    context.tsx         # App hook facade backed by Redux
    store/              # Redux Toolkit store, slices, selectors, hooks
```

## Running Locally

```bash
pnpm install
pnpm exec nx serve cribstop-next
# or
cd apps/clients/cribstop/next
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## UX Inspiration

Airbnb's search experience, browse flow, card layout, and high-end visual presentation — adapted for
residential real estate with full MLS compliance requirements layered in from the start.

## Bright MLS Compliance Checklist

The following items are required for the site to pass Bright MLS IDX compliance review. Sources:
**Web Site Compliance Checklist**, **Required Disclosures document**, and **Sample Compliance
Website**.

### ❌ Missing — Must Fix Before Approval

- [ ] **Broker attribution on every listing card** (`ListingCard`) The listing broker's name must
      appear on every listing display, not only on the detail page. Required format:
      `"Listing Courtesy of [Broker/Office Name]"`. Currently `ListingCard` shows no broker at all.

- [ ] **`© BRIGHT, All Rights Reserved` copyright notice** The footer currently only shows
      `© Cribstop.com · Real Broker LLC`. The Bright MLS-specific copyright phrase
      `"© BRIGHT, All Rights Reserved"` must also appear on every page that displays IDX content.
      It must be presented in a way that does not imply Bright MLS is the listing broker.

- [ ] **Exact IDX disclosure wording** Current footer text ("Listing information is provided by
      Bright MLS…") does not match the required verbatim text:

  > _"The data relating to real estate for sale on this website appears in part through the BRIGHT
  > Internet Data Exchange program, a voluntary cooperative exchange of property listing data
  > between licensed real estate brokerage firms in which [Real Broker LLC] participates, and is
  > provided by BRIGHT through a licensing agreement."_

- [ ] **`OfficeBrokerLeadMail` and `OfficeBrokerLeadPhoneNumber` fields displayed on listings** The
      Checklist requires: _"If available, the following fields must be displayed:
      OfficeBrokerLeadMail, OfficeBrokerLeadPhoneNumber."_ These fields are not in the `Listing`
      type or data, and are not rendered anywhere.

- [ ] **Dynamic "Data last updated" date in footer** The footer hardcodes
      `"April 21, 2026 at 12:00 PM ET"`. The Checklist requires the most recent update date of IDX
      content. This must be derived dynamically from the highest `lastUpdated` value across all
      listings, not hardcoded.

- [ ] **Licensee state(s) of licensure disclosure** Required: _"Websites of licensees affiliated
      with a participant's firms shall disclose the firm's name and the licensee's state(s) of
      licensure in a reasonable and readily apparent manner."_ No state licensure disclosure
      currently exists anywhere on the site.

### ⚠️ Secondary — Required Depending on Content Claims

- [ ] **IDX non-participation exclusion disclaimer** The hero section uses phrases like _"verified
      Bright MLS listings"_ which imply completeness of available inventory. If any such claim is
      made, the following disclaimer must also appear legibly:

  > _"Some real estate firms do not participate in IDX and their listings do not appear on this
  > website. Some properties listed with participating firms do not appear on this website at the
  > request of the seller."_

- [ ] **Sold/closed listing disclaimers** The data model includes a `'Sold'` status. If Sold
      listings are ever displayed, each must be labeled `"Closed"`, `"Settled"`, or `"Recent Sale"`,
      and two additional disclaimers are required:

  > _"This home sale information is not to be construed as an appraisal and may not be used as such
  > for any purpose."_ _"BRIGHT MLS is the (or a) provider of this home sale information and has
  > compiled content from various sources. Some properties represented may not have actually sold
  > due to reporting errors."_

- [ ] **Automated valuation disclaimer (if AVM is added)** If an estimated value / AVM feature is
      added, it must not be called an "appraisal" and the above sold-data disclaimers apply.

### ✅ Already Present

- [x] Accuracy disclaimer: "Information Deemed Reliable But Not Guaranteed" — footer
- [x] Personal non-commercial use notification — footer
- [x] "Some properties may no longer be available" availability disclaimer — footer
- [x] Listing broker name on detail page (agent card sidebar + listing disclosure block)
- [x] Per-listing "Data last updated" on detail page (uses `formatDate(listing.lastUpdated)`)
- [x] "Real Broker LLC" brokerage name in footer and company section
- [x] Equal Housing Opportunity link — footer
- [x] Listing type disclosures on detail page (courtesy of, listed by, Bright MLS credit)
- [x] No statement implying direct MLS database access (no "Search entire MLS database" copy found)

---

## Implementation Plan

### 1 — Add broker attribution to `ListingCard`

**File:** `src/components/ListingCard.tsx`

Add a line below the price displaying `"Listing courtesy of {listing.officeName}"` in a small muted
font. This satisfies the broker-per-listing requirement and the broker-attribution-on-cards sample
from the compliance doc.

### 2 — Fix the footer: exact IDX wording + Bright copyright

**File:** `src/components/Footer.tsx`

Replace the current "MLS Disclosure" block with two distinct sections:

- **IDX Source Disclosure** using the exact verbatim BRIGHT IDX paragraph (with `Real Broker LLC`
  interpolated as the participating firm).
- **Bright MLS Copyright** line: `"© BRIGHT, All Rights Reserved"` separated visually from the
  Cribstop site copyright so it is clear BRIGHT is the data source, not the broker.

The footer must show this block on every page (it is already in the global layout — no page changes
needed).

### 3 — Dynamic last-updated date in footer

**File:** `src/components/Footer.tsx`

Replace the hardcoded date string with a computed value. Since the footer is a server-friendly
component (no `'use client'`), import `listings` from `@/lib/listings` and compute:

```ts
const lastUpdated = listings.reduce(
  (max, l) => (l.lastUpdated > max ? l.lastUpdated : max),
  listings[0].lastUpdated,
);
```

Then render it with
`new Date(lastUpdated).toLocaleString('en-US', { timeZone: 'America/New_York' })`.

### 4 — Add `OfficeBrokerLeadMail` and `OfficeBrokerLeadPhoneNumber` to data model

**Files:** `src/lib/types.ts`, `src/lib/listings.ts`, `src/app/listing/[id]/page.tsx`

1. Add optional fields to the `Listing` interface:
   ```ts
   officeBrokerLeadMail?: string;
   officeBrokerLeadPhone?: string;
   ```
2. Populate them in the mock data for a representative subset of listings.
3. On the detail page, render them in the agent/broker card if present.

### 5 — Add state licensure disclosure

**File:** `src/components/Footer.tsx` (or `src/app/layout.tsx` for sitewide placement)

Add a small line in the footer compliance block:

> `"Real Broker LLC is licensed in MD, DC, VA and additional states. License #: [number]"`

This satisfies the "firm name + state(s) of licensure in a reasonable and readily apparent manner"
requirement.

### 6 — Add IDX non-participation exclusion disclaimer

**File:** `src/components/Footer.tsx`

Add the required disclaimer paragraph to the MLS Disclosure block. This is a one-line addition that
satisfies the completeness-claim requirement triggered by the hero section copy.

---

# Build a next.js Mockup project in directly in this folder apps/clients/cribstop/next

Build a high-fidelity **Next.js** mockup for a real estate marketplace called **Cribstop.com**,
owned by an agent from **Real Broker LLC**. The site should feel like **Airbnb for real
estate**—clean, modern, premium, image-forward, and highly searchable—but focused on **buying,
selling, and renting homes** instead of short-term stays. Use **static JSON data** as the only data
source for now; do not connect to any backend, API, CMS, or live MLS feed.

## Goal

Create a polished public-facing website mockup that demonstrates the end-user experience of
searching, browsing, saving, and viewing real estate listings. The experience should feel familiar
to Airbnb users: large hero search, category pills, elegant listing cards, responsive grid layout,
saved homes, and a detailed property page. The design should be modern, trustworthy, spacious, and
mobile-first.

## Brand

- Site name: **Cribstop.com**
- Brokerage/owner display: **Real Broker LLC**
- Brand tone: modern, approachable, trustworthy, premium
- Visual direction: Airbnb-inspired marketplace UI, but clearly for residential real estate

## Core pages

1. **Homepage**
2. **Search results page**
3. **Listing details page**
4. **Favorites / saved homes page**
5. **Login / sign up / forgot password pages**
6. **About / compliance footer area**

## Authentication experience

Include a full **user authentication UI** with:

- Login page.
- Sign up page.
- Forgot password page.
- Email and password fields.
- “Remember me” checkbox.
- Social sign-in buttons for Google and Apple as UI only.
- Profile avatar menu for signed-in users.
- Saved homes and search alerts available only after login.
- A polished modal or dedicated auth page layout that matches the site brand.

Authentication is **mocked only** for the UI; no real backend is needed.

## Homepage requirements

- Large hero section with a natural-language search bar like:
  - “Where do you want to live?”
  - location, price, home type, rent/buy/sell toggle
- Airbnb-style category row:
  - Homes for Sale
  - Homes for Rent
  - Open Houses
  - Luxury
  - New Construction
  - Condos
  - Townhomes
  - Investment Properties
- Featured listing cards with strong imagery, price, address/neighborhood, beds, baths, sqft, and
  listing broker attribution
- “Just listed,” “Price reduced,” and “Open house” badges
- Clean top navigation with logo, search, favorites, login, and profile menu
- Subtle map-preview or neighborhood-preview section
- Responsive layout that works beautifully on desktop and mobile

## Search and browsing UX

- Include advanced filters for:
  - Buy / Rent / Sell
  - Price range with slider and min/max inputs
  - Beds
  - Baths
  - Property type
  - Square footage
  - Neighborhood
  - Open house
  - New construction
  - Waterfront
  - Pet friendly
  - Amenities such as pool, garage, gym, elevator, balcony, fireplace, washer/dryer, pet friendly,
    waterfront, office, rooftop, garden
- Search results should be displayed in a clean card grid similar to Airbnb
- Add optional sort controls:
  - Recommended
  - Newest
  - Price low to high
  - Price high to low
- Each listing card should show:
  - primary photo
  - price
  - address or neighborhood
  - bed/bath/sqft
  - property type
  - listing broker name
  - favorite heart icon
  - quick badge chips for amenities or status

## Listing detail page

Design a premium property detail page with:

- Image gallery at top
- Large headline section with price, address, property type, beds, baths, sqft
- Broker attribution shown clearly
- Listing description
- Key facts and amenities
- Similar homes section
- Mortgage or affordability teaser card
- Contact agent / schedule tour CTA
- Saved listing action
- Search alerts or inquiry CTA
- Disclaimers and compliance footer content visible on page

## Data model

Use a local JSON file with mock listing data. Include fields such as:

- id
- title
- address
- city
- state
- zip
- price
- status
- listingType
- propertyType
- beds
- baths
- sqft
- imageUrls
- brokerName
- brokerPhone
- brokerEmail
- officeName
- lastUpdated
- description
- amenities
- latitude
- longitude
- featured
- openHouse
- priceReduced
- newConstruction
- listedBy
- isSaved
- isFavorited

## Compliance-aware UI

The mockup must include a visible compliance/footer area that reflects Bright MLS-style public
display expectations. Add tasteful but clearly visible placeholder disclosure text such as:

- “Bright MLS is credited as the source of the information.”
- “The data is deemed reliable but not guaranteed.”
- “The information provided is for personal, non-commercial use.”
- “Listing courtesy of [broker name]”
- “Data last updated: [date/time]”
- “Some properties may no longer be available.”
- “Real Broker LLC” displayed clearly as the brokerage name on every page where listings appear

These disclosures should be visible in the UI, but the site should still look polished and
consumer-friendly, not like a legal form. Place them in a tasteful footer and near listing detail
content.

## Technical requirements

- Use **Next.js with App Router**
- Use **TypeScript**
- Use **Tailwind CSS**
- Use **component-based architecture**
- Use **mock JSON data only**
- No backend, no authentication service, no database, no external API calls
- Use reusable components for:
  - Header
  - Search bar
  - Filter panels
  - Price range slider
  - Amenity chips
  - Listing card
  - Property gallery
  - Details panel
  - Auth forms
  - Footer disclosures
- Make the UI feel production-ready even though it is only a mockup
- Optimize for responsiveness and clean spacing
- Use realistic placeholder images and sensible fake real estate copy

## UX inspiration

Take inspiration from Airbnb’s:

- search experience
- browse flow
- card layout
- high-end visual presentation
- trust-building UI
- minimal but rich interface

But adapt it for residential real estate, not travel.

## Output

Generate the full Next.js mockup structure, components, sample JSON data, and page layouts needed to
run the demo locally. The final result should look like a credible real estate marketplace product
called Cribstop.com.

Prioritize a visually compelling design over functionality, since this is a compliance review mockup
meant to demonstrate the public display experience.
