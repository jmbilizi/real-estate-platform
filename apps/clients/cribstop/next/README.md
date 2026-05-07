# Build a next.js Mockup project in directly in this folder apps/clients/platform/next

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
