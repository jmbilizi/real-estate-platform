# Product Requirements Document (PRD)

**Cribstop Real Estate Platform — Buy, Sell & Rent Marketplace with Integrated Services, Community,
Messaging, Media, and Social Ecosystem**

> Consumer brand: **Cribstop.com**. Brokered by **Real Broker, LLC** (licensed in **MD, DC, and
> VA**). Listing data sourced from **Bright MLS** and internal/FSBO submissions. Per MLS rules, the
> licensed brokerage is always the most prominent brand; "Cribstop" is the product/marketplace name
> and is displayed as secondary.

---

## 1. Purpose and Vision

Build a scalable, modular real estate platform that unifies three consumer experiences under one
brand (**Cribstop.com**, brokered by **Real Broker, LLC**):

1. **Homes** — an Airbnb-quality marketplace to **buy, sell, and rent** residential real estate,
   backed by verified listings from **Bright MLS** plus internal/FSBO submissions.
2. **Services** — a curated marketplace/directory connecting buyers, sellers, homeowners and renters
   with trusted real estate and other service professionals (agents, lenders, inspectors,
   contractors, movers, attorneys, appraisers, cleaners, etc...) for both transaction-driven needs
   and everyday homeownership upkeep (maintenance, insurance, refinancing, tax appeals) — and
   connecting aspiring professionals with licensing information and mentors to help them break into
   the industry.
3. **Connect** — the community and information layer where everyone involved in a real estate
   transaction, service, or career — buyers, sellers, renters, owners, agents, service
   professionals, and landlords — can connect, share, and stay informed: market insights,
   neighborhood discussion, professional discovery, and professional networking/mentorship for
   people building a career in the industry.

The platform serves consumers (buyers, sellers, renters), real estate professionals and aspiring
professionals, and landlords managing multiple communities and properties of varying composition. It
combines verified listings, dynamic professional/landlord–consumer communication, and interactive
community features — all unified by centralized media management and a consistent property
hierarchy. Initial market focus is the **DMV (Maryland, DC, Northern Virginia)**, matching the
brokerage's licensure.

### 1.1 Business Model

- **Homes** monetizes through brokerage representation: buyer/seller/renter leads route to **Real
  Broker, LLC** agents (commission on closed transactions) and, where the consumer chooses, to
  partner agents under disclosed, RESPA-compliant referral agreements (Section 6.4).
- **Services** monetizes the provider side: featured placement and category sponsorship,
  verified/premium tiers, lead-routing/lead fees, and booking commissions for bookable categories
  (Section 5.10).
- **Connect** is not directly monetized; it drives acquisition, retention, and qualified intent into
  Homes and Services.
- All monetization must remain compliant with Fair Housing, RESPA, and MLS brand rules (Section 6),
  with fees and referral relationships disclosed to the consumer.

---

## 2. Architectural Overview

### 2.1 Infrastructure Stack

```
Internet (HTTPS)
   ↓
Ingress Controller (Nginx)
   ├─ TLS Termination (Let's Encrypt via cert-manager)
   ├─ L7 Routing (api.yoursite.com/*)
   ├─ WebSocket Upgrade (for real-time messaging)
   └─ DDoS Protection & Rate Limiting
      ↓
Ocelot API Gateway (ClusterIP Service)
   ├─ Authentication & Authorization (cookie / opaque bearer / API key, validated via account-service)
   ├─ Service-Level Rate Limiting
   ├─ Request Routing & Load Balancing
   ├─ Swagger Aggregation (MMLib.SwaggerForOcelot)
   └─ OpenTelemetry Tracing Integration
      ↓
Microservices (ClusterIP - Internal Only):
   ├─ account-service:3000      (User management, authentication)
   ├─ messaging-service:3001    (Real-time chat, WebSocket)
   ├─ listings-service:3002     (Property hierarchy, search, MLS ingestion)
   ├─ social-service:3003       (Community posts, events)
   ├─ services-service:3004     (Professional directory, bookings, leads)
   ├─ media-service:3005        (Presigned uploads, media metadata, processing)
   └─ notification-service:3006 (Channel delivery: in-app, email, push, SMS)
      ↓
Data Layer (StatefulSets):
   ├─ PostgreSQL 18 + PostGIS (Multi-tenant databases)
   ├─ Redis/Valkey 9.0 (Pub/Sub, Streams event bus, caching, rate limiting)
   └─ ElasticSearch (Search indexing)

Monitoring (External - Secured):
   └─ Jaeger UI (jaeger.{env}.domain.com)
      ├─ TLS via cert-manager (Let's Encrypt ACME)
      ├─ BCrypt Basic Authentication (htpasswd)
      ├─ Security Headers (X-Frame-Options, X-Content-Type-Options, X-XSS-Protection)
      └─ Session Affinity for consistent UI experience
```

### 2.2 Service Responsibilities

| Service              | Technology & Role                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ingress Controller   | Nginx Ingress Controller for HTTPS termination, external routing, WebSocket support, and certificate management via cert-manager                                                                                                                                                                       |
| API Gateway          | Ocelot (.NET 9.0) for internal service routing, authentication forwarding (cookie / opaque bearer / API key, validated by account-service), rate limiting, and Swagger aggregation                                                                                                                     |
| Account Service      | .NET (ASP.NET Core 10 Minimal APIs) + ASP.NET Identity + PostgreSQL for identity, authentication, a six-tier RBAC hierarchy, multi-app tracking, API keys, and audited/soft-deletable profiles                                                                                                         |
| Listings Service     | Node.js + Express + PostgreSQL for the Communities → Properties → Units → Listings hierarchy, the consumer listing model (Section 3.1), property relationship claims (Section 3.2), saved searches & alerts, and Bright MLS ingestion/sync (RESO Web API) with MLS↔internal deduplication             |
| Messaging Service    | Node.js + Express + WebSocket + PostgreSQL + Redis for real-time multi-user chat with persistent storage                                                                                                                                                                                               |
| Social Media Service | Node.js + Express + PostgreSQL + ElasticSearch for community posts, comments, events with scoped visibility                                                                                                                                                                                            |
| Services Service     | Node.js + Express + PostgreSQL + ElasticSearch for the professional directory, provider profiles, service listings, bookings/leads/quotes/mentorship requests, and reviews                                                                                                                             |
| Media Service        | Node.js + Express + PostgreSQL for presigned-URL issuance, the platform-wide `media_files` metadata (Section 9), and async media-processing workers (thumbnailing, transcoding, virus scan)                                                                                                            |
| Notification Service | Node.js + Redis Streams consumers for channel delivery (in-app, email, push, SMS), digests, quiet hours, and per-channel consent enforcement — preferences owned by account-service (Section 13)                                                                                                       |
| Media Storage        | AWS S3 with presigned URLs for all media files (listings, messages, posts, profile images)                                                                                                                                                                                                             |
| Event Bus            | **Redis Streams** (on the existing Redis/Valkey) as the asynchronous event bus and durable work-queue backbone for cross-service domain events, notification fan-out, search indexing, and media processing. RabbitMQ remains a documented alternative if routing/throughput needs grow (Section 2.3). |
| Observability        | Jaeger 1.76.0 all-in-one with BadgerDB persistence, externally accessible via Ingress with BCrypt auth, TLS termination, and security headers for production-grade monitoring                                                                                                                          |
| Shared Libraries     | TypeScript across frontend/backend using Nx for shared models and utilities                                                                                                                                                                                                                            |

### 2.3 Asynchronous Eventing Backbone — Redis Pub/Sub vs. Redis Streams

To avoid running a second broker, the platform uses **Redis for both** real-time and durable
messaging, with a clear split by Redis primitive. All consumers must assume **at-least-once
delivery** and be **idempotent**, so correctness never depends on exactly-once semantics; no
synchronous user flow may depend on the bus. **RabbitMQ is intentionally not adopted** — it stays a
documented alternative if complex routing, very high throughput, or built-in
dead-lettering/backpressure become necessary.

| Concern                         | Technology    | Why                                                                                              |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| Real-time chat fan-out/presence | Redis Pub/Sub | Lowest latency, ephemeral, tied to live WebSocket connections; loss-tolerant                     |
| Caching, rate limiting          | Redis         | In-memory speed                                                                                  |
| Durable domain events           | Redis Streams | Persistent append-only log, consumer groups, acks, and replay — no extra infrastructure          |
| Async work queues               | Redis Streams | Reliable background jobs (email/push/SMS sends, media processing, indexing) with consumer groups |

**Design principles for the Redis Streams event bus:**

- **One stream per domain aggregate** (e.g., `listing`, `service`, `media`, `user`, `payment`) with
  a versioned `type` field on each entry (e.g., `listing.created`, `service.booking.confirmed`);
  each service reads via its own **consumer group** (`XREADGROUP` / `XACK`).
- **At-least-once delivery** with **idempotent consumers**; poison messages are retried via the
  pending-entries list (`XAUTOCLAIM`) and moved to a per-stream **dead-letter stream** after N
  attempts.
- **Outbox pattern** in each producing service (write the event to a DB outbox in the same
  transaction, then relay to the stream) to avoid dual-write inconsistency.
- **Bounded streams** via `MAXLEN`/trimming + AOF persistence for durability without unbounded
  memory growth.
- **Schema/versioning** for event payloads via shared TypeScript/.NET contracts; backward-compatible
  evolution.
- Publishers never block on consumers; a Redis outage must not break synchronous user flows (degrade
  gracefully, replay from the outbox on recovery).
- **Portability:** keep the producer/consumer code behind a thin broker abstraction so a later move
  to RabbitMQ (or Kafka) is a swap of the transport, not the business logic.

**Where the event bus fits (event producers → consumers):**

- **Listings → Search / Notifications:** `listing.created` / `listing.updated` /
  `listing.priceReduced` / `listing.openHouse` re-index in ElasticSearch (Section 12) and trigger
  saved-search & price-drop alerts (Section 13); `listing.sold` and `property.claim.approved` /
  `property.claim.rejected` / `property.claim.expired` drive claim lifecycle and notifications
  (Sections 3.2 and 13).
- **Media pipeline:** `media.uploaded` → async thumbnailing/transcoding/virus-scan workers, emitting
  `media.processed` (Section 9).
- **Services marketplace:** `service.request.created` / `service.booking.confirmed` /
  `service.quote.received` / `service.provider.approved` / `service.provider.rejected` drive
  provider/consumer notifications, directory visibility, and status updates (Sections 5.2 and 5.4).
- **Account:** `user.registered` / `user.verified` / `user.suspended` for onboarding emails, badge
  propagation, and downstream cache invalidation (Section 11).
- **Messaging:** durable delivery of **offline** notifications and cross-device sync, while live
  in-session delivery stays on Redis Pub/Sub (Section 7).
- **Payments:** `payment.succeeded` / `payment.refunded` for receipts, payout events, and booking
  state transitions (Section 14).

---

## 3. Domain & Property Model

- **Community:** Higher-level entity grouping multiple properties managed together.
- **Property:** Physical building or standalone home related to one community.
- **Unit:** Subdivision of a property (e.g., apartment unit); optional for single-family homes.
- **Listing:** An offer linked to a `property_id` and optionally to a `unit_id`.

Supports flexible composition: townhomes or single-family homes (property only), or multi-unit
buildings.

### 3.1 Consumer Listing Model (Marketplace)

Beyond the management hierarchy above, the consumer marketplace requires a richer listing shape,
shared by the web client and the listings service:

- **Listing type:** `sale` | `rent` | `sold` (the platform supports buy, sell, and rent — not
  rentals only).
- **Listing source:** `brightMLS` | `internal` | `other` — tracks provenance for MLS compliance,
  attribution, and deduplication.
- **Property type:** Single Family, Condo, Townhome, Multi-Family, Loft, Land, New Construction.
- **Status:** Active, Pending, Coming Soon, Sold.
- **Core attributes:** price, beds, baths, sqft, lot size, year built, neighborhood, city/state/zip,
  `latitude`/`longitude` (map), image gallery, description, `lastUpdated`.
- **Amenities:** structured enum (Pool, Garage, Gym, Elevator, Balcony, Fireplace, Washer/Dryer, Pet
  Friendly, Waterfront, Office, Rooftop, Garden, Smart Home, Solar, EV Charging).
- **Merchandising flags:** `featured`, `priceReduced`, `newConstruction`, `openHouse`
  (date/start/end).
- **Attribution (required):** listing broker name/phone/email and office name plus office broker
  lead contact — displayed on every listing for MLS/brokerage compliance.
- **Consumer state (per user):** `isSaved` / `isFavorited` for saved homes and search alerts.

### 3.2 Property Relationship Claims

Several features need a verified answer to "what is this account's relationship to this property?" —
FSBO listing and listing claims, the Verified Resident badge, seller opt-in for service history
(Section 4.6), and landlord/agent authority over properties. Rather than each feature verifying its
own way, the platform has **one** claims model, owned by the **listings-service** (which owns the
property hierarchy):

- **Claim record:** account ↔ property (or unit), `relationshipType` (`owner` | `resident` |
  `listing_agent` | `landlord_manager`), evidence method, `status` (`pending_review` | `approved` |
  `rejected` | `expired`), reviewer, decision reason, and expiry. One account may hold multiple
  claims of different types across properties (Section 11.2 — roles are additive).
- **Evidence tiers by relationship type:**
  - `listing_agent` — automatic: match the agent's verified license/MLS ID against the listing agent
    ID in the Bright MLS feed (Section 6.2). No manual review needed.
  - `owner` — public-records match (tax assessor / deed name vs. the account's verified identity —
    public data) and/or document upload; **admin-reviewed** before approval, mirroring Section 5.4.
  - `resident` (renter or owner-occupant) — postcard code mailed to the address (no PII documents),
    or lease/utility-bill upload, or landlord attestation. Attestation must be **tenant-initiated or
    tenant-consented** — a landlord may never unilaterally assert someone's tenancy.
  - `landlord_manager` — deed/entity records (owned portfolio) or a management agreement (managed
    portfolio); **admin-reviewed**.
- **Privacy & legality:** evidence documents flow through the media pipeline (Section 9) encrypted,
  are retained only until the decision plus a short deletion window, then destroyed — only the
  outcome, method, reviewer, and timestamps persist. No FCRA-regulated consumer reports are used. A
  failed or absent claim never limits browsing or searching homes (Fair Housing — claims gate
  _assertions about a property_, not access to housing content). The Verified Resident badge renders
  at neighborhood level only, never the street address.
- **Lifecycle:** claims expire on a per-type schedule and are event-invalidated — e.g.,
  `listing.sold` on the event bus (Section 2.3) marks the prior owner's claim `expired`; an MLS
  listing-agent change invalidates the old agent claim.
- **Consumers of approved claims:** List-a-Property / claim-a-listing (Section 4.1), seller opt-in
  for service-history badges (Section 4.6), Verified Resident in Connect (Section 8), landlord and
  assistant per-entity scoping (Section 11.2), and homeowner re-engagement targeting (Section 13).
  Claim decisions are audited (Section 11.3) and notify the claimant (Section 13).

---

## 4. Consumer Web Client (Cribstop.com) & Information Architecture

The primary consumer surface is a Next.js web app (`apps/clients/cribstop/next`) backed by the
platform services through the API gateway. Its top-level navigation is organized around the **three
products** as tabs — **Homes**, **Services**, and **Connect** — each with its own contextual search
bar.

**One account, many roles:** all surfaces coexist under a single login — consumer browsing, the
provider dashboard, and landlord management are entry points, not separate accounts or locked modes
(Section 11.2). Role context is chosen per action; any Airbnb-style "switch to hosting" toggle is
purely presentational and never partitions the account's data.

### 4.1 Homes tab

The core marketplace for buying, selling, and renting.

- Airbnb-style hero and adaptive/compact search (location, price, home type, buy/rent/sell intent).
- Category pills: Homes for Sale, Homes for Rent, Open Houses, Luxury, New Construction, Condos,
  Townhomes, Investment Properties.
- Listing grid + cards with imagery, price, address/neighborhood, beds/baths/sqft, broker
  attribution, and "Just listed"/"Price reduced"/"Open house" badges.
- Interactive map view (listing markers, single-listing map on detail).
- Advanced filters + sort; listing detail page and modal; mortgage teaser.
- Saved/Favorites; search alerts (post-login).
- **List a Property** flow: agent posting, homeowner/FSBO selling, and claiming an existing listing
  — each gated by an approved property relationship claim of the matching type (`listing_agent` or
  `owner`, Section 3.2); nothing publishes on an unverified assertion of ownership or agency.
- Cross-tab integration with Services and Connect: see Section 4.6.

### 4.2 Services tab

A marketplace/directory of trusted professionals for every home, home-transaction, everyday
homeownership, and real-estate-career need — see Section 5.

### 4.3 Connect tab

The community layer where everyone in a real estate transaction, service, or career — consumers,
professionals, aspiring professionals, and landlords — connects and stays informed:

- Activity feed of neighbor and professional posts (scoped to neighborhood/market).
- Trending topics (e.g., price drops, first-time-buyer tips, mortgage-rate updates).
- Neighborhood groups with membership.
- Professional & topic groups (e.g., career mentorship, cross-market industry discussion) — a scope
  parallel to neighborhood groups, open to any role but aimed at professionals and aspiring
  professionals (Section 5.1).
- Gated preview (sign-up required to view/participate) with waitlist capture.
- Backed by the Social Media service (Section 8) with neighborhood- and professional/topic-scoped
  visibility.
- Cross-tab integration with Homes and Services: see Section 4.6.

### 4.4 Supporting pages & experiences

- **Apps panel:** a waffle menu in the navbar giving quick access to **supporting surfaces only** —
  Account, Business (provider registration/directory), List a Property, Saved, Messages, and Alerts.
  Listing intent is not an app: buy/rent/sell lives in the Homes search (intent toggle +
  `listingType` filters), so the panel must not contain "For Sale" / "For Rent" tiles or otherwise
  duplicate search functionality.
- **Auth:** login, sign up, forgot password (modal-based and dedicated pages), onboarding modal,
  Google/Apple social sign-in (UI), profile avatar menu. Onboarding captures the user's **intents as
  an optional multi-select** (buying, selling, renting, owning, offering services, exploring a
  career — any combination), changeable at any time in Account; it never forces a single persona,
  and a zero-intent, zero-transaction account is fully functional.
- **Account** and **About/compliance** pages.
- **Business Directory:** transparent professional profiles, reviews, and direct contact.
- **Favorites / Saved homes.**
- **Notifications & messaging entry points** (bell, messages) in the nav.

### 4.5 Mobile client

A native mobile client (Expo / React Native) accompanies the web app, reusing the same shared
TypeScript models, API contracts, account/auth, messaging, and notification systems. It prioritizes
Homes search, saved homes, messaging, and push notifications.

### 4.6 Cross-Tab Value Loops

The three products are designed to reinforce each other — the same account, listing, and provider
data should surface across tabs to drive engagement and informed decisions, not sit in silos. Homes
→ Services and Connect → Services are detailed in Section 5.7; the remaining directions:

| Direction                                                         | What crosses over                                                                                                                                                                                                                                              | Compliance guardrail                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Homes → Connect**                                               | New / price-reduced / open-house listings surface as neighborhood activity; aggregated sold/closed data feeds market-insight trending topics; open houses appear as neighborhood events.                                                                       | Every listing card carries required Bright MLS broker attribution wherever it renders, including inside a Connect feed card (Section 6.2). Sold/closed data display must follow Bright MLS's specific solds-display policy (delay window, required disclaimer) — confirm exact terms with Bright MLS before implementation. Copy stays Fair-Housing neutral (objective data only, no "safe"/"family" framing).                                                       |
| **Services → Homes**                                              | A completed, verified service record becomes a trust signal on the listing itself (e.g., "Pre-inspected," "Professionally photographed"); an agent's own Services rating surfaces on their listings; a contractor's before/after can back a "renovated" claim. | Requires the **current seller's affirmative opt-in** to attach service history to their specific listing — established via an approved `owner` claim (Section 3.2), since a past project may belong to a prior owner. Inspection-derived badges must carry a disclaimer that they do not replace the buyer's own inspection and are not a condition guarantee. Only sourced from an actual completed, verified `service_request` — never self-reported.              |
| **Services → Connect**                                            | Opt-in closing/project milestone posts ("Just closed on my first home!"); newly Verified providers suggested into matching Professional/Topic groups; "top-rated this month" content sourced from real completed-request reviews (Section 5.5).                | Milestone posts are opt-in with price/address disclosure optional and consumer-controlled, never automatic. Any paid/featured provider placement surfaced in Connect must be labeled "Sponsored"/"Featured" (FTC disclosure, consistent with the RESPA disclosure norms in Section 6.4) — never presented as organic ranking.                                                                                                                                        |
| **Connect → Homes**                                               | Neighborhood discussion volume shown as a neutral, factual signal (e.g., "12 people are discussing this neighborhood this week") on search/listing pages; saved-search alerts cross-promoted from an active neighborhood group.                                | Show aggregate counts/links only — never individual quotes or sentiment scoring next to a commerce listing, since unmoderated user content surfaced in a transactional context raises Fair-Housing risk. Underlying Connect content remains subject to the same moderation as Section 6.3.                                                                                                                                                                           |
| **Connect → Homes (early access)** — _compliance-review-required_ | A property already filed with Bright MLS under the existing `Coming Soon` status (Section 3.1) can be cross-posted to a matching neighborhood group ahead of full `Active` visibility.                                                                         | Must **only** surface a listing already properly filed with Bright MLS as `Coming Soon` — never a pre-MLS/off-MLS teaser. Publicly marketing a property before MLS submission risks violating NAR's **Clear Cooperation Policy** (1-business-day MLS submission rule) and raises Fair Housing equal-access concerns from selective early visibility. Requires explicit legal/broker sign-off before implementation — a flagged future idea, not a committed feature. |

---

## 5. Services Marketplace & Professional Directory

A curated marketplace — modeled on the Airbnb Services experience but adapted to real estate — that
connects consumers with vetted professionals, and a directory where those professionals maintain
rich, reviewable profiles. Where Airbnb lets guests browse and book a chef or photographer, Cribstop
lets buyers, sellers, renters, homeowners, and aspiring professionals discover, request, and (where
applicable) book the professionals they need at every stage of the home journey — from transaction
through everyday ownership to building a real estate career — all inside the same account,
messaging, and review system used for Homes.

### 5.1 Service categories & engagement models

Unlike Airbnb, real estate services do not all fit a single "pick a time and pay" model. Each
category maps to one of four engagement models, which determines the flow the consumer sees. All 13
categories below are available from launch — there is no category-based rollout; risk and quality
are managed per-provider through the mandatory review-and-approval gate (Section 5.4), not by
withholding categories.

| Category                                  | Engagement model      | How it works                                                                                                                                             |
| ----------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buyer / Seller (Listing) Agents           | Lead & consultation   | Request a consultation or get matched; contact exchange, no upfront pay                                                                                  |
| Mortgage & Finance (Lenders)              | Lead & consultation   | Request pre-approval/rate quote; routed to lender                                                                                                        |
| Real Estate Attorneys                     | Lead & consultation   | Request a consultation for closing/contract review                                                                                                       |
| Home Inspectors                           | Bookable appointment  | Pick date/time + property; provider confirms; pay/deposit in-app                                                                                         |
| Appraisers                                | Bookable appointment  | Schedule appraisal for a specific address                                                                                                                |
| Cleaning Services                         | Bookable appointment  | Pick date/time + scope; instant or request-to-book                                                                                                       |
| Photographers / Stagers                   | Bookable appointment  | Schedule listing media/staging for a property                                                                                                            |
| Contractors & Renovations                 | Quote & project       | Submit project details; receive multiple quotes; select a pro                                                                                            |
| Movers & Logistics                        | Quote & project       | Submit move details (from/to, size, date); receive quotes                                                                                                |
| Home Maintenance & Repair                 | Bookable appointment  | Handyman, HVAC, plumbing, electrical, landscaping, pest control, roofing — pick date/time + property + issue type; provider confirms; pay/deposit in-app |
| Home Insurance & Refinancing              | Lead & consultation   | Request a homeowners-insurance quote or a refinance/HELOC consultation; routed to insurance broker/lender                                                |
| Property Tax Appeal & Valuation           | Lead & consultation   | Request an assessment-appeal review or a free valuation/CMA; routed to an agent or tax specialist                                                        |
| Explore a Career (Licensing & Mentorship) | Mentorship & guidance | Browse licensing/education requirements by category; request a mentor or a "shadow a pro" session; no payment                                            |

The Services tab's contextual search collects **What** (category) + **Where** (location within the
DMV) and routes to the appropriate model above.

### 5.2 Consumer discovery & booking flow

1. **Discover** — From the Services tab, browse categories or run a What/Where search. Optionally
   enter from a listing ("Book an inspection for this home"), from Connect (e.g., a
   Professional/Topic group), or — for non-transacting homeowners — from a
   maintenance/insurance/tax-appeal reminder.
2. **Browse providers** — Ranked list/grid of provider cards: photo, name, category/specialty,
   rating & review count, price range or "Free consultation," service area, and a **Verified**
   badge. Filters: category, price, rating, availability, service area, language, specialty.
3. **View provider profile** — Full profile (see 5.3) with services/packages, credentials,
   portfolio, reviews, and typical response time.
4. **Request / Book** — Flow depends on the engagement model:
   - **Bookable appointment:** choose a service/package → pick date/time from availability → confirm
     property/address & details → request-to-book or instant book → pay or place deposit in-app.
   - **Lead & consultation:** submit a short intent form (goal, timeline, budget, property of
     interest) → provider receives the lead → contact exchange / scheduled consultation.
   - **Quote & project:** submit structured project details (scope, budget, timeline, media) →
     provider(s) return quotes → consumer compares and selects.
   - **Mentorship & guidance:** browse licensing/education requirements and mentor availability for
     a category → request mentorship or a "shadow a pro" session → mentor accepts and schedules → no
     payment required.
5. **Communicate** — All follow-up happens in in-app messaging (Section 7), keeping a record tied to
   the request.
6. **Fulfillment** — Appointment reminders, status (Requested → Confirmed → Completed), and
   rescheduling/cancellation per provider policy.
7. **Review** — After completion, a two-way review prompt (consumer rates provider; provider may
   rate the interaction). Reviews feed the provider's rating.
8. **Post-service** — Booking history in Account; one-tap rebooking and referrals; suggested next
   services (e.g., after inspection → contractors).

### 5.3 Provider profiles & service listings

Each provider profile (mirroring an Airbnb host/service listing) includes:

- Identity: display name, business name, photo/logo, category & specialties, **Verified** badge,
  years in business, languages, service areas (DMV neighborhoods/counties).
- Credentials: license type & number where applicable, insurance/bonding status, certifications;
  agents link to their **brokerage** (Section 6).
- Services/packages: named offerings with description, what's included, duration, and
  price/price-range (or "Free consultation"/"Request a quote").
- Portfolio: photos/media (via centralized media store), past projects, before/after where relevant.
- Social proof: aggregate rating, individual reviews, completed-jobs count, typical response time.
- Availability: calendar for bookable categories; lead/quote intake for the others.
- Contact: in-app request/message CTA (direct phone/email revealed per provider settings/plan).
- Mentor availability: providers/agents may opt in to mentor or host "shadow a pro" sessions for
  aspiring professionals in their category, surfaced as a distinct badge/CTA on their profile.

### 5.4 Provider onboarding & verification flow

1. **Apply** — "Register your business" from the Services tab or Business Directory; submit
   category, credentials, and intended services/packages.
2. **Verify** — Category-specific verification: license validation (agents, lenders, inspectors,
   appraisers, attorneys), insurance/bonding (contractors, movers, cleaners), and identity/business
   checks.
3. **Admin review & approval** — Every application is manually reviewed by platform staff
   (`Admin`/`Moderator`, Section 11.1) regardless of automated verification outcome; only `Approved`
   applications are published. No provider or listing goes live automatically on submission.
   Rejected applications receive a reason and may resubmit.
4. **Build profile** — Add categories, bio, credentials, portfolio media, service areas, and
   services/packages with pricing. Profile and listing content added or changed after approval
   remains subject to ongoing content moderation; staff (`Admin`/`Moderator`) can unpublish a
   provider or listing that violates policy.
5. **Set intake** — Configure availability (bookable), or lead/quote intake preferences and
   auto-responses.
6. **Publish** — Go live in the directory and category search once `Approved`.
7. **Operate** — Receive and respond to bookings/leads/quotes; schedule; message; get paid
   (bookable).
8. **Manage & grow** — Dashboard for calendar, requests, messages, reviews, and performance; opt
   into featured placement / lead routing (5.10).

### 5.5 Reviews, trust & safety

- Reviews are tied to a completed request to reduce fake reviews; two-way where appropriate.
- **Self-dealing guard:** because one account can hold both consumer and provider roles (Section
  11.2), requests where the consumer is — or belongs to the same account/business as — the
  fulfilling provider are blocked, and can never produce a review or count toward ratings,
  completed-jobs, or response-time stats.
- Verification badges, license/insurance display, and reporting/flagging.
- Dispute handling for bookings and quotes; provider policies (cancellation, rescheduling) surfaced
  before booking.

### 5.6 Payments & fulfillment

- **Bookable appointments** support in-app payment or deposit (payments provider TBD); receipts and
  refunds per policy.
- **Lead & consultation** and **quote & project** categories are typically transacted off-platform
  for high-value work; the platform captures the lead, messaging, and (optionally) an agreed-scope
  record. Payment rails for these are a future consideration.
- **Mentorship & guidance** requests are free — no in-app payment; a future paid-coaching tier is a
  possible extension, not in scope now.

### 5.7 Integration with Homes & Connect

- **From a listing (Homes):** contextual CTAs — "Book an inspection," "Get pre-approved," "Request a
  showing/agent," "Order listing photos" — pre-fill the request with the property.
- **From Connect:** professionals surfaced in neighborhood discussions link to their Services
  profile; "Looking for a contractor" posts can convert into quote requests; Professional/Topic
  groups (e.g., "Aspiring Agents DMV") surface providers open to mentorship, and a mentorship post
  can convert into an Explore-a-Career request.
- **For non-transacting homeowners:** Home Maintenance & Repair, Home Insurance & Refinancing, and
  Property Tax Appeal & Valuation are discoverable directly from the Services tab and via periodic
  re-engagement notifications — not gated behind an active listing or transaction.
- **Shared systems:** Account (identity/roles), Messaging (all provider–consumer chat), and the
  media store (portfolios) are reused — not rebuilt.

See Section 4.6 for the full cross-tab value-loop matrix, including the Services → Homes and
Services → Connect directions not covered above.

### 5.8 Backing service & data model

Backed by a dedicated **services-service** (see Section 2). Core entities:

- `service_providers` — owner user/business, categories, verification status, `applicationStatus`
  (`pending_review` | `approved` | `rejected` — gates directory visibility independent of
  verification), service areas, credentials, ratings aggregate, mentor opt-in flag.
- `service_listings` (packages) — provider offering: title, description, engagement model, pricing,
  duration, inclusions.
- `service_availability` — bookable slots/calendar per provider/listing.
- `service_requests` — unified booking/lead/quote/mentorship record: consumer, provider, listing,
  engagement model (`booking` | `lead` | `quote` | `mentorship`), property reference (optional),
  status, scheduled time, scope/details.
- `service_quotes` — quotes returned against a request (for the quote & project model).
- `service_reviews` — completed-request-linked reviews and ratings.
- Media (portfolios) referenced via the platform-wide `media_files` table (Section 9).

### 5.9 Compliance

- Professional listings must display accurate licensing/attribution; agent profiles tie back to
  their **brokerage** (Real Broker, LLC prominence rules where the brokerage is involved — Section
  6).
- All provider- and consumer-facing copy is **Fair Housing** compliant; no steering.
- Verification claims (license/insurance) must be validated before the Verified badge is shown.

### 5.10 Monetization

Monetization varies by category and engagement model (Section 5.1), on top of provider review and
approval (Section 5.4):

- **Bookable appointment** categories (Home Inspectors, Appraisers, Cleaning Services,
  Photographers/Stagers, Home Maintenance & Repair) monetize via booking commission, plus optional
  featured placement.
- **Lead & consultation** categories (Buyer/Seller Agents, Mortgage & Lenders, Real Estate
  Attorneys, Home Insurance & Refinancing, Property Tax Appeal & Valuation) monetize via
  lead-routing/lead fees and verified/premium tier subscriptions; Buyer/Seller Agent leads
  additionally carry brokerage commission on closed transactions (Section 1.1).
- **Quote & project** categories (Contractors & Renovations, Movers & Logistics) monetize via lead
  fees/subscriptions.
- **Mentorship & guidance** (Explore a Career) is not directly monetized — a retention/engagement
  play for Services and Connect alike; a future paid-coaching tier is a possible extension, not in
  scope now.
- **All monetized categories** may additionally purchase **featured placement and category
  sponsorship** — always labeled "Sponsored"/"Featured" wherever surfaced (Section 4.6), never
  presented as organic ranking.

Exact pricing and packaging per category to be specified.

---

## 6. Brand, Compliance & MLS Integration

### 6.1 Brokerage & brand prominence (Bright MLS rule)

- The licensed brokerage **Real Broker, LLC** must always be the **most prominent** brand on the
  site; the **Cribstop** product name is displayed smaller/secondary. Centralized in the web
  client's `brand.ts` and propagated to navbar, footer, metadata, and page copy.
- Licensure disclosed as **MD, DC, and VA**; jurisdiction claims must match actual licensure.

### 6.2 Bright MLS data integration

- **Ingestion:** listings sync from Bright MLS via its RESO Web API / approved feed (owned by the
  listings-service), on a cadence that satisfies MLS refresh rules; `lastUpdated` reflects feed
  freshness.
- Listings sourced from **Bright MLS** are tagged `source: brightMLS` and carry required
  broker/office attribution on every card and detail view.
- Internal and FSBO/claimed listings are tagged `source: internal` (or `other`) and must not be
  represented as MLS-sourced.
- Respect MLS display, refresh/`lastUpdated`, and attribution requirements; support deduplication
  between MLS and internal records.

### 6.3 Fair Housing & content compliance

- All listing, marketing, Services, and Connect copy must comply with the **Fair Housing Act** — no
  language expressing or implying preference/limitation based on protected classes, and no steering.
- Never present fabricated prices, sold data, reviews, or testimonials as real; clearly label sample
  or mock data during pre-launch phases.

### 6.4 Lead-contact, transaction & privacy compliance

- **Contact consent:** obtain explicit opt-in before calls/SMS; honor **TCPA** and **Do-Not-Call**;
  provide easy opt-out/unsubscribe on every channel (**CAN-SPAM** for email). Persist consent and
  per-channel preferences (see Sections 11 and 13).
- **RESPA:** disclose any affiliated-business or referral relationships; no illegal kickbacks for
  settlement-service referrals; keep referral/lead fees compliant and disclosed.
- **Payments:** no raw card data stored on-platform — delegate to a **PCI-DSS**-compliant provider
  (Section 14).
- **Data privacy:** handle PII per applicable law (e.g., **CCPA**, **Virginia CDPA**); honor data
  access/deletion requests and reasonable retention limits.
- **Claim-evidence retention:** property-relationship evidence documents (deeds, leases, utility
  bills — Section 3.2) are encrypted, retained only until the claim decision plus a short deletion
  window, then destroyed; only the outcome, method, reviewer, and timestamps persist.

---

## 7. Messaging System Design

### 7.1 Data Model

All keys as UUIDs for scale.

| Table                           | Key Columns & Purpose                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `messaging.chats`               | `id`, `name`, `is_group_chat`, `profile_image_url`, `created_by`, timestamps                                    |
| `messaging.chat_participants`   | `chat_id`, `user_id`, `role`, `joined_at`                                                                       |
| `messaging.messages`            | `id`, `chat_id`, `sender_id`, `reply_to`, `message_type ENUM`, `text`, `created_at`, `updated_at`, `is_deleted` |
| `messaging.message_recipients`  | `message_id`, `receiver_id`, `status ENUM (DELIVERED, READ)`, `read_at`, `deleted`                              |
| `messaging.message_attachments` | `id`, `message_id`, `media_id` (S3 reference), `file_name`, `mime_type`, `size`, `created_at`                   |

### 7.2 Business Rules and Validation

- On message creation, validate `message_type` with payload content:
  - `'TEXT'`: non-empty `text`, no attachments.
  - `'MEDIA'`: attachments present, `text` empty/null.
  - `'TEXT_AND_MEDIA'`: both present.
  - `'SYSTEM'`: textual system info; NO attachments.
- Prevent empty messages (neither text nor attachments).
- System messages stored in `text` field with `message_type = 'SYSTEM'`.

### 7.3 Functional Specs

- Real-time message delivery via WebSockets with Redis Pub/Sub for scalability.
- Read and delivery receipts stored per recipient accurately.
- Soft delete support on both sender and receiver sides.
- Multiple attachments per message handled asynchronously, stored in S3 referenced by
  `message_attachments`.
- **Offline & cross-device notifications** fan out via the **Redis Streams** event bus (durable,
  consumer-group work queues), while live in-session delivery stays on Redis Pub/Sub (Section 2.3).

---

## 8. Social & Community (Connect)

A single social service powers both the consumer **Connect** experience — where consumers,
professionals, and landlords connect and stay informed — and landlord/managed-community social,
differentiated by scope and role.

- **Post scopes:** Neighborhood / Market (consumer Connect), Professional / Topic
  (cross-neighborhood professional networking and mentorship groups, e.g., "Aspiring Agents DMV,"
  "Contractor Network"), and Community → Property → Unit (managed / landlord contexts).
- **Content types:** activity feeds, posts, comments, reactions, events, trending topics, and
  neighborhood/interest groups with membership.
- **Role-based visibility & posting rights:** consumers (buyers/sellers/renters), providers/agents,
  landlords, and assistants — each scoped to the contexts they belong to (Section 11). For
  multi-role accounts, rights are the **union** of all held roles' contexts — holding one role never
  narrows what another grants.
- **Verified Resident badge:** an approved `resident` or `owner` claim (Section 3.2) renders a
  neighborhood-level badge on posts and group membership — never the street address. Verification is
  optional and applied uniformly; unverified users can still participate.
- **Gated preview:** unauthenticated users see a blurred preview; sign-up is required to view or
  participate, with waitlist capture pre-launch.
- **Media & real-time:** attachments via the centralized S3 store; real-time update streams via
  Redis Pub/Sub to connected clients; search over people, topics, neighborhoods, and groups (Section
  12).

---

## 9. Media Storage Strategy

- Unified media store on AWS S3 with versioning and lifecycle policies, fronted by the
  **media-service** (Section 2).
- All media uploads done via presigned URLs issued by the media-service.
- Metadata stored in the platform-wide `media_files` table (owned by the media-service) linking to
  chats, listings, posts, user profiles.
- Enforced security with IAM roles, encryption, and transient access links.
- **Async processing:** a `media.uploaded` event on the **Redis Streams** event bus triggers
  thumbnailing/transcoding/virus-scan workers that emit `media.processed` when ready (Section 2.3).

---

## 10. API and Integration Contracts

- Account service manages users, roles, and auth credentials (cookies, opaque bearer tokens, API
  keys).
- Listings service provides CRUD for communities, properties, units, listings with hierarchical
  queries, plus property relationship claims (Section 3.2), Bright MLS ingestion/sync, and saved
  searches.
- Messaging service exposes REST and WebSocket endpoints for chat lifecycle, message CRUD, and
  delivery management.
- Social media service handles posts, comments, events REST APIs with filtering by scope.
- Services service exposes REST APIs for provider profiles, service listings/packages, availability,
  and unified booking/lead/quote/mentorship requests and reviews.
- Media service generates presigned URLs and links metadata.
- Notification service consumes domain events and delivers per-channel notifications, honoring the
  consent flags owned by account-service.
- Account service also stores notification preferences and contact-consent (opt-in/opt-out) records.
- Search is powered by ElasticSearch + PostGIS across listings and the provider directory.

---

## 11. User Roles, Identity & Access Control (RBAC)

Identity and access are owned by the **account-service** (ASP.NET Core 10 Minimal APIs + ASP.NET
Identity + PostgreSQL/EF Core) and shared across all front-end apps.

### 11.1 Platform & staff roles, authentication, and account model

**Role hierarchy** — six tiers, cumulative (higher roles inherit lower permissions), seeded at
startup:

| Role         | Description                                                              |
| ------------ | ------------------------------------------------------------------------ |
| `SuperAdmin` | Full platform access including billing and role management               |
| `Admin`      | User/content/config management; cannot modify `SuperAdmin`/`Admin` roles |
| `Moderator`  | Content moderation and user suspension; no role management               |
| `Support`    | Read-only access to user data for dispute handling                       |
| `Developer`  | Internal engineering access for diagnostics                              |
| `User`       | Standard platform user — **assigned automatically on registration**      |

**Authentication schemes** — three, evaluated in order (first success wins):

- **Cookie** (`Identity.Application`) — browser clients; `HttpOnly`, `SameSite=Strict`, sliding
  14-day window; security stamp re-validated on every request (instant revocation on soft-delete).
- **Bearer token** (`Identity.Bearer`) — non-browser clients; **opaque DataProtection tokens (not
  JWT)** with refresh.
- **API key** (`X-Api-Key`) — service-to-service/automation; SHA-256 hashed, per-user, optional
  `AppId`/`Scopes`, max 10 active keys.

**Account & identity model** (on `ApplicationUser`):

- Profile: names, `DisplayName`, bio, DOB, profile/cover image references.
- **Account status lifecycle** (lookup): Active / Suspended / Banned.
- **Verification** is two-layered: account-level `VerifiedAt` / `VerifiedByUserId` /
  `VerificationNote` (e.g., "Government ID") establishes **identity** only; professional
  **credentials** are verified per category on the `service_providers` record (Section 5.8). The
  Services Verified badge requires both, scoped to that category — an inspector's license
  verification never renders a badge on the same person's profile in another category.
- **Notification & consent flags**: `EmailNotificationsEnabled`, `SmsNotificationsEnabled`,
  `PushNotificationsEnabled`, `MarketingOptIn` (see Sections 6.4 and 13).
- **Multi-app tracking** (`UserApp`): which apps a user has used (e.g., `cribstop`, `admin-portal`).
- Preferred locale; `LastLoginAt`.
- **Full JSON audit trail** (`PreviousState` chain), created/updated/deleted-by, and soft-delete
  with immediate session revocation.

### 11.2 Domain roles

The roles above are **platform/staff** roles. To support the three-tab product, the platform also
requires consumer- and professional-facing **domain roles** (modeled as Identity roles, a
profile/capability model, or claims), layered on top of the base `User` registration.

Unlike the hierarchical staff tiers in 11.1, domain roles are **additive, non-exclusive facets**: a
single account may simultaneously be an owner, renter, buyer, agent, service provider, and landlord
— or none of these yet. The capability model must support any combination concurrently; no
single-value `user_type` field may exist anywhere in the platform, and gaining a role never removes
or restricts another.

| Domain role                    | Needed for                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Consumer (buyer/seller/renter) | Saved homes, alerts, service requests, Connect — intent may be multiple per account                     |
| Agent                          | List-a-Property, representing buyers/sellers; tied to a brokerage; agent-license verification           |
| Service Provider               | Provider profile, service listings, availability, bookings/leads/quotes; license/insurance verification |
| Landlord / Property Manager    | Manage Communities → Properties → Units → Listings and managed-community social                         |
| Assistant                      | Delegated, scoped access under a landlord or agent (assigned entities only)                             |

Verification hooks (`VerifiedAt`/`VerificationNote`) and multi-app tracking on the account model
support these; the domain-role / capability model must also enforce per-entity **scoping** (e.g.,
assistant limited to assigned communities/listings; provider limited to their own records).
Landlord/agent authority over a _specific_ property derives from an approved property relationship
claim (Section 3.2) — holding the Landlord or Agent role alone grants no per-property rights.

Aspiring professionals (not yet verified) act under the base `Consumer` domain role: they can
request mentorship, join Professional/Topic Connect groups, and browse Explore-a-Career content
without a verification gate. Verified `Service Provider` accounts gain an optional mentor opt-in
flag once approved (Section 5.4).

### 11.3 Enforcement

- All endpoints require authentication; the default policy accepts any of the three schemes.
- Roles are cumulative and enforced server-side, with assignment rules that prevent privilege
  escalation (e.g., `Admin` cannot modify `SuperAdmin`/`Admin`).
- Cross-service: the API gateway authenticates and forwards identity; each service enforces its own
  authorization (defense in depth).
- Sensitive actions are audited (role changes, verification decisions, service-provider application
  approval/rejection, property-relationship-claim approval/rejection/expiry, soft-deletes; future:
  listing changes, payouts, data exports).

---

## 12. Search & Discovery

- **Listings search:** keyword + structured filters (listing type, price, beds/baths, sqft, property
  type, amenities, status), sort (recommended / newest / price), and persisted **saved searches &
  alerts**.
- **Geospatial:** PostGIS-backed map-bounds (“search this area”), radius, and neighborhood polygons;
  every listing carries `latitude`/`longitude`.
- **Relevance & full-text:** ElasticSearch index across listings and the provider directory;
  location typeahead/autocomplete; index freshness on listing updates (respecting MLS refresh),
  driven by `listing.*` events on the **Redis Streams** event bus (Section 2.3).
- **Index ownership:** each domain service owns its own index — listings-service indexes listings,
  services-service indexes the provider directory, social-service indexes Connect content.
- **Services search:** What (category/specialty) + Where (service area) with filters (price, rating,
  availability, verified).
- **Connect search:** people, topics, neighborhoods, and groups.
- **SEO:** server-rendered public listing/detail pages, schema.org structured data
  (`RealEstateListing`), canonical URLs, and sitemaps (see Section 15).

---

## 13. Notifications & Alerts

- **Channels:** in-app (bell), email, and push (web now, mobile later); SMS only with consent.
- **Event types:** new listings matching a saved search, price drops, open houses, saved-home status
  changes, new messages, service request/booking status, quotes received, mentorship request status,
  provider application decisions (approved/rejected with reason — Section 5.4), property
  relationship claim decisions and expiry (Section 3.2), and Connect activity (mentions, replies,
  group posts).
- **Homeowner re-engagement reminders** (maintenance, insurance review, tax-appeal season — Section
  5.7) are marketing-adjacent: they require `MarketingOptIn` in addition to the channel-level flags,
  and every send honors Section 6.4.
- **Preferences:** per-channel, per-category opt-in/opt-out managed in Account and persisted on the
  user in account-service (`EmailNotificationsEnabled`, `SmsNotificationsEnabled`,
  `PushNotificationsEnabled`, `MarketingOptIn`); categories span both the consumer side (saved
  searches, bookings) and provider side (new leads, application decisions) of the same account, each
  independently controllable; every send honors the consent/compliance rules in Section 6.4.
- **Delivery:** Redis Pub/Sub for real-time in-app delivery; the **notification-service**
  (Section 2) handles email/push/SMS batching and digests off **Redis Streams** work queues
  (consumer groups; Section 2.3), decoupled from the emitting service.
- **Frequency controls:** instant / daily digest / weekly, plus quiet hours.

---

## 14. Payments & Transactions

- **In scope:** in-app payment for **bookable** Services (inspections, cleaning, photography,
  appraisal, home maintenance & repair) — deposits, full payment, receipts, and refunds per provider
  policy.
- **Provider payouts:** connected-account model (payments provider TBD, e.g., Stripe Connect) with
  an optional platform fee/commission.
- **Out of scope:** earnest money, closing funds, and rent collection — high-value real estate funds
  are handled off-platform via licensed escrow/title; the platform may record status only.
- **Lead/quote categories:** no upfront payment; monetized via lead fees/subscriptions (Section
  5.10).
- **Compliance:** PCI-DSS via the payments provider (no raw card data stored), RESPA for any
  referral fees, and clear fee disclosure before checkout (Section 6.4).

---

## 15. Non-Functional Requirements

| Category              | Requirement                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Latency               | Sub-2 seconds response for listings and feeds. Sub-1 second for chat messages.                                                          |
| Scalability           | Horizontally scalable microservices using Kubernetes/Docker.                                                                            |
| Reliability           | 99.9% uptime with redundant message delivery confirmation.                                                                              |
| Security              | TLS everywhere, encrypted storage, strong RBAC enforcement.                                                                             |
| Observability         | Distributed tracing with <1% performance overhead, 95th percentile latency tracking, automatic service dependency mapping.              |
| Maintainability       | Nx monorepo with CI/CD automation and shared TypeScript codebases.                                                                      |
| Accessibility         | WCAG 2.1 AA: semantic HTML, full keyboard navigation, visible focus states, form labels, image alt text, and sufficient color contrast. |
| SEO & Discoverability | SSR for public pages, schema.org structured data, canonical URLs, sitemaps, and strong Core Web Vitals.                                 |
| Privacy & Legal       | Fair Housing, TCPA / CAN-SPAM / Do-Not-Call, RESPA, PCI-DSS (via provider), and CCPA / Virginia CDPA data-subject rights.               |

---

## 16. Metrics and Success Criteria

**Acquisition & engagement**

- Monthly active users; **60% 30-day retention**; listing views; search-to-detail rate; saved-home
  rate.

**Homes funnel**

- Saved homes and search-alert opt-ins; listing inquiries / showing requests; lead-to-agent
  conversion; end-to-end listing-to-lease/sale conversion tracking; property-claim application →
  approval rate and median review turnaround (Section 3.2).

**Services marketplace**

- Provider activation; application → approval rate and median admin-review turnaround (a slow review
  queue starves marketplace supply — Section 5.4); request/booking volume; request → booking /
  quote-acceptance rate; median provider response time; review coverage and average rating.

**Connect**

- Post engagement with **>30% of active users**; group participation; waitlist → active conversion;
  Professional/Topic group participation and mentorship-request fulfillment rate.

**Messaging reliability**

- **≥99.9%** message delivery success; **100%** read-receipt accuracy.

**Quality & performance**

- Meet latency NFRs and Core Web Vitals thresholds; **99.9%** uptime.

---

## 17. Engineering & Delivery Requirements

- Database schema changes ship as versioned migration scripts (UUID keys, enums, indices,
  constraints).
- Backend REST and WebSocket APIs for Messaging, Listings, Services, Social/Connect, Media, Search,
  and Notifications define exact parameter and response shapes (OpenAPI, aggregated at the gateway).
- Media uploads use presigned URLs with attachments linked consistently via `media_files` (Section
  9).
- Shared TypeScript models carry validation logic (e.g., messaging content rules) and are consumed
  by both clients and Node services; .NET contracts mirror them where needed.
- Nx drives build, lint, type-check, test, and integration pipelines across the monorepo, respecting
  project dependencies and side effects.
- Hierarchical data usage (Community → Property → Unit → Listing → Messaging scoping) is documented
  alongside the schemas.
- OpenTelemetry auto-instrumentation on every service with zero-code-change integration; Jaeger is
  an optional observability dependency (services function independently if unavailable).
- The **Redis Streams** event bus follows Section 2.3: per-domain streams with consumer groups,
  pending-entries retry (`XAUTOCLAIM`) + dead-letter streams, a transactional **outbox** in each
  producer, and shared event-contract packages behind a broker abstraction.
