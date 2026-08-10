# `libs/property-contracts` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one Zod-defined listings wire contract as an Nx library, consumed by
`property-service` and `cribstop-next`, with the build wiring that keeps both images honest.

**Architecture:** A `@nx/js` library holds the request and response schemas. Runtime validation, the
TypeScript types the web app imports, and the OpenAPI document all derive from those same schemas —
no hand-written spec, no second source of truth. Nothing imports it at runtime yet; #22 adds the
endpoints.

**Tech Stack:** TypeScript, Zod 4.4.x (`z.toJSONSchema`), Nx 21 (`@nx/js:lib`, `bundler=tsc`), Jest,
pnpm workspaces.

**Ticket:** [#47](https://github.com/jmbilizi/real-estate-platform/issues/47) · **Spec:**
`docs/superpowers/specs/2026-08-08-listing-contracts-lib-design.md`

## Global Constraints

- Package name is `@cribstop/property-contracts`; Nx project name is `property-contracts`.
- Zod **v4** (`^4.4.3`), using built-in `z.toJSONSchema()`. **No converter package.**
- **No `tsconfig` `paths` entry** anywhere. Resolution is pnpm `workspace:*` + TS project
  references.
- Never run raw tool commands. Always `pnpm run …` / `pnpm exec nx …`.
- Never bypass git hooks (`--no-verify`); never force-push.
- **No field-selection / sparse-fieldset parameter** may be defined in any schema.
- **No `hasOpenHouse` boolean** and **no `imageUrls: string[]`** may be defined in any schema.
- Nullable-always-present: nullable fields use `.nullable()` and are **never** `.optional()`, never
  omitted, never `0`/`""` sentinels.
- `description` appears on the **detail** schema only — never on a list row.
- The field is `officeBrokerLeadEmail` (the client's `officeBrokerLeadMail` is a typo fixed here).
- `apps/clients/cribstop/next/src/lib/contracts.check.ts` is **type-only**. It must not import
  runtime values, and must not modify any component, `lib/types.ts`, or rendering code — that is
  #24.
- `pnpm-lock.yaml` is Prettier-ignored. Reconcile it with an install, never by hand-editing.
- Every commit message starts `#47 `.

---

### Task 1: Generate the library and register it in the workspace

**Files:**

- Create: `libs/property-contracts/` (generator output)
- Create: `libs/property-contracts/CLAUDE.md`
- Modify: `pnpm-workspace.yaml`
- Modify: `libs/property-contracts/package.json`, `libs/property-contracts/project.json`

**Interfaces:**

- Consumes: nothing.
- Produces: an Nx project named `property-contracts` with working `build`, `test`, `lint`,
  `type-check`, `format` and `format-check` targets, published to the workspace as
  `@cribstop/property-contracts`.

- [ ] **Step 1: Generate the library**

`--linter=none` is load-bearing — the default emits a **new root `eslint.config.mjs`**, which would
change flat-config resolution repo-wide.

```bash
pnpm exec nx g @nx/js:lib libs/property-contracts \
  --name=property-contracts \
  --bundler=tsc \
  --unitTestRunner=jest \
  --linter=none \
  --no-interactive
```

Expected: creates
`libs/property-contracts/{project.json,package.json,tsconfig*.json,jest.config.ts,src/index.ts}` and
updates root `tsconfig.json` with a project reference. **If it also reports
`CREATE eslint.config.mjs` at the repo root, delete that file** — the flag did not take.

- [ ] **Step 2: Register the package in the pnpm workspace**

The generator does **not** touch `pnpm-workspace.yaml`, and `workspace:*` resolution fails without
this. Replace the commented-out shared-libs block:

```yaml
# shared libs for web and mobile apps
- 'libs/property-contracts'
```

- [ ] **Step 3: Set the package identity and dependency**

In `libs/property-contracts/package.json`:

```json
{
  "name": "@cribstop/property-contracts",
  "version": "0.0.1",
  "private": true,
  "description": "The listings wire contract (PRD §3.1) — one definition for validation, types and OpenAPI",
  "main": "./src/index.js",
  "types": "./src/index.d.ts",
  "dependencies": {
    "zod": "^4.4.3"
  }
}
```

- [ ] **Step 4: Copy the target and tag shape from property-service**

In `libs/property-contracts/project.json`, set `tags` and add the four targets that
`apps/services/property-service/project.json` defines. Auto-tagging infers
`runtime`/`type`/`platform` but not `scope`/`framework`:

```json
{
  "tags": [
    "runtime:node",
    "type:lib",
    "platform:shared",
    "framework:zod",
    "scope:properties",
    "devteam:unassigned"
  ],
  "targets": {
    "lint": {
      "executor": "nx:run-commands",
      "cache": true,
      "options": {
        "command": "eslint --config tools/node/configs/eslint.config.js libs/property-contracts",
        "cwd": "."
      }
    },
    "type-check": {
      "executor": "nx:run-commands",
      "cache": true,
      "inputs": [
        "{projectRoot}/**/*.ts",
        "{projectRoot}/tsconfig*.json",
        "{workspaceRoot}/tsconfig.json",
        "^production"
      ],
      "options": {
        "command": "tsc -b --noEmit libs/property-contracts/tsconfig.json",
        "cwd": "."
      }
    },
    "format": {
      "executor": "nx:run-commands",
      "options": { "command": "prettier --write .", "cwd": "libs/property-contracts" }
    },
    "format-check": {
      "executor": "nx:run-commands",
      "options": { "command": "prettier --check .", "cwd": "libs/property-contracts" }
    }
  }
}
```

Keep whatever `build` target the generator emitted — do not replace it.

- [ ] **Step 5: Install and resync Nx**

```bash
pnpm install
pnpm run nx:reset
```

- [ ] **Step 6: Verify the project is real**

```bash
pnpm exec nx show project property-contracts --json
pnpm exec nx build property-contracts
pnpm exec nx type-check property-contracts
pnpm exec nx lint property-contracts
```

Expected: all four succeed, and `nx show project` lists `build`, `test`, `lint`, `type-check`,
`format`, `format-check`.

- [ ] **Step 7: Write the project CLAUDE.md**

Create `libs/property-contracts/CLAUDE.md` covering: what this package is (the single definition of
the listings wire contract), what belongs in it (schemas, derived types, the OpenAPI builder), what
does **not** (SQL, HTTP, environment access, anything importing `pg` or `express`), the
no-`paths`-entry rule, the prohibition on field-selection parameters / `hasOpenHouse` / `imageUrls`,
and that `libs/` was empty before this package so its shape is the template for four more Node
services.

- [ ] **Step 8: Commit**

```bash
git add libs/property-contracts pnpm-workspace.yaml pnpm-lock.yaml nx.json tsconfig.json
git commit -m "#47 feat(contracts): scaffold the property-contracts library"
```

---

### Task 2: Shared enums and value-object schemas

**Files:**

- Create: `libs/property-contracts/src/common.ts`
- Test: `libs/property-contracts/src/common.spec.ts`

**Interfaces:**

- Consumes: Task 1's project.
- Produces: `LISTING_TYPES`, `PROPERTY_TYPES`, `AMENITIES`, `CONSUMER_STATUSES`, `LISTING_SOURCES`
  (const tuples); `listingTypeSchema`, `propertyTypeSchema`, `amenitySchema`,
  `consumerStatusSchema`, `listingSourceSchema`, `mediaSchema`, `openHouseSchema`,
  `attributionSchema` (Zod schemas); and the inferred types `Media`, `OpenHouse`, `Attribution`.

- [ ] **Step 1: Write the failing test**

`AMENITIES` must match the closed 15-value set that `listings.amenities` enforces with a database
`CHECK` (see `apps/services/property-service/migrations/1785801600003_create-listings.js`). A drift
here means the API accepts a filter value the database will never match.

```ts
// libs/property-contracts/src/common.spec.ts
import { AMENITIES, amenitySchema, attributionSchema, mediaSchema } from './common';

describe('common schemas', () => {
  it('locks the amenity set to the 15 values the database CHECK allows', () => {
    expect([...AMENITIES]).toEqual([
      'Pool',
      'Garage',
      'Gym',
      'Elevator',
      'Balcony',
      'Fireplace',
      'Washer/Dryer',
      'Pet Friendly',
      'Waterfront',
      'Office',
      'Rooftop',
      'Garden',
      'Smart Home',
      'Solar',
      'EV Charging',
    ]);
  });

  it('rejects an amenity outside the closed set', () => {
    expect(amenitySchema.safeParse('Helipad').success).toBe(false);
  });

  it('requires alt text to be present on media, even when null', () => {
    expect(mediaSchema.safeParse({ url: 'https://x/y.jpg' }).success).toBe(false);
    expect(mediaSchema.safeParse({ url: 'https://x/y.jpg', altText: null }).success).toBe(true);
  });

  it('keeps every attribution key present (NAR 7.58)', () => {
    const parsed = attributionSchema.parse({
      listingAgentName: null,
      brokerName: 'B',
      brokerPhone: '1',
      brokerEmail: 'b@x',
      officeName: 'O',
      officeBrokerLeadPhone: null,
      officeBrokerLeadEmail: null,
      listedBy: 'B – O',
    });
    expect(Object.keys(parsed).sort()).toEqual([
      'brokerEmail',
      'brokerName',
      'brokerPhone',
      'listedBy',
      'listingAgentName',
      'officeBrokerLeadEmail',
      'officeBrokerLeadPhone',
      'officeName',
    ]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm exec nx test property-contracts` Expected: FAIL — `Cannot find module './common'`.

- [ ] **Step 3: Implement `common.ts`**

```ts
import { z } from 'zod';

/** The three-value consumer listing type. `sold` is derived from status, not stored. */
export const LISTING_TYPES = ['sale', 'rent', 'sold'] as const;
export const PROPERTY_TYPES = [
  'Single Family',
  'Condo',
  'Townhome',
  'Multi-Family',
  'Loft',
  'Land',
  'New Construction',
] as const;
/** Closed set — mirrors the CHECK on `listings.amenities`. Adding a value here without a
 *  migration produces a filter the database can never satisfy. */
export const AMENITIES = [
  'Pool',
  'Garage',
  'Gym',
  'Elevator',
  'Balcony',
  'Fireplace',
  'Washer/Dryer',
  'Pet Friendly',
  'Waterfront',
  'Office',
  'Rooftop',
  'Garden',
  'Smart Home',
  'Solar',
  'EV Charging',
] as const;
export const CONSUMER_STATUSES = ['Active', 'Pending', 'Coming Soon', 'Sold'] as const;
export const LISTING_SOURCES = ['brightMLS', 'internal', 'other'] as const;

export const listingTypeSchema = z.enum(LISTING_TYPES);
export const propertyTypeSchema = z.enum(PROPERTY_TYPES);
export const amenitySchema = z.enum(AMENITIES);
export const consumerStatusSchema = z.enum(CONSUMER_STATUSES);
export const listingSourceSchema = z.enum(LISTING_SOURCES);

/** Media is an object, never a bare URL: alt text is an accessibility requirement and is
 *  consumer-visible copy subject to the same review as a description. */
export const mediaSchema = z.object({
  url: z.string(),
  altText: z.string().nullable(),
});

/** Instants, not date strings — so "upcoming" is a comparison rather than a parse. */
export const openHouseSchema = z.object({
  startsAt: z.string(),
  endsAt: z.string(),
  remarks: z.string().nullable(),
});

/** NAR Policy 7.58 + PRD §6.2. Every key is present on every row; no caller may strip them. */
export const attributionSchema = z.object({
  listingAgentName: z.string().nullable(),
  brokerName: z.string(),
  brokerPhone: z.string(),
  brokerEmail: z.string(),
  officeName: z.string(),
  officeBrokerLeadPhone: z.string().nullable(),
  officeBrokerLeadEmail: z.string().nullable(),
  listedBy: z.string(),
});

export type Media = z.infer<typeof mediaSchema>;
export type OpenHouse = z.infer<typeof openHouseSchema>;
export type Attribution = z.infer<typeof attributionSchema>;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec nx test property-contracts` Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add libs/property-contracts/src/common.ts libs/property-contracts/src/common.spec.ts
git commit -m "#47 feat(contracts): add shared listing enums and value objects"
```

---

### Task 3: Search request schema

**Files:**

- Create: `libs/property-contracts/src/search-request.ts`
- Test: `libs/property-contracts/src/search-request.spec.ts`

**Interfaces:**

- Consumes: `amenitySchema`, `listingTypeSchema`, `propertyTypeSchema` from `./common`.
- Produces: `PAGE_SIZE_DEFAULT` (20), `PAGE_SIZE_MAX` (100), `searchRequestSchema`, and the types
  `SearchRequestInput` (raw query strings) and `SearchRequest` (parsed).

- [ ] **Step 1: Write the failing test**

```ts
// libs/property-contracts/src/search-request.spec.ts
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, searchRequestSchema } from './search-request';

describe('searchRequestSchema', () => {
  it('defaults to all listing types and a page size of 20', () => {
    const parsed = searchRequestSchema.parse({});
    expect(parsed.listingType).toBe('all');
    expect(parsed.pageSize).toBe(PAGE_SIZE_DEFAULT);
    expect(parsed.page).toBe(1);
  });

  it('coerces numeric query strings to numbers', () => {
    const parsed = searchRequestSchema.parse({ beds: '3', minPrice: '250000' });
    expect(parsed.beds).toBe(3);
    expect(parsed.minPrice).toBe(250000);
  });

  it('rejects an unknown query parameter rather than ignoring it', () => {
    const result = searchRequestSchema.safeParse({ bed: '3' });
    expect(result.success).toBe(false);
  });

  it('defines no field-selection parameter', () => {
    for (const key of ['fields', 'select', 'include', 'omit', 'exclude']) {
      expect(searchRequestSchema.safeParse({ [key]: 'brokerName' }).success).toBe(false);
    }
  });

  it('accepts amenities as a repeated parameter or a comma list', () => {
    expect(searchRequestSchema.parse({ amenities: ['Pool', 'Garage'] }).amenities).toEqual([
      'Pool',
      'Garage',
    ]);
    expect(searchRequestSchema.parse({ amenities: 'Pool,Garage' }).amenities).toEqual([
      'Pool',
      'Garage',
    ]);
  });

  it('rejects an amenity outside the closed set', () => {
    expect(searchRequestSchema.safeParse({ amenities: 'Helipad' }).success).toBe(false);
  });

  it('caps pageSize at the documented server-side maximum', () => {
    expect(searchRequestSchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(searchRequestSchema.parse({ pageSize: String(PAGE_SIZE_MAX) }).pageSize).toBe(
      PAGE_SIZE_MAX,
    );
  });

  it('parses boolean flags from their string form', () => {
    expect(searchRequestSchema.parse({ openHouse: 'true' }).openHouse).toBe(true);
    expect(searchRequestSchema.parse({ waterfront: 'false' }).waterfront).toBe(false);
    expect(searchRequestSchema.safeParse({ openHouse: 'yes' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm exec nx test property-contracts` Expected: FAIL — `Cannot find module './search-request'`.

- [ ] **Step 3: Implement `search-request.ts`**

Numeric params use `z.string().regex(...).transform(Number)` rather than `z.coerce.number()`
deliberately: under `io: "input"` a coerced primitive has an `unknown` input type and renders as an
empty `{}` in the emitted JSON Schema, which would make the published spec useless for those fields.

```ts
import { z } from 'zod';
import { amenitySchema, listingTypeSchema, propertyTypeSchema } from './common';

/** Preserves the client's existing paging arithmetic in
 *  `apps/clients/cribstop/next/src/app/(with-search)/search/page.tsx`. */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

const queryInt = z.string().regex(/^\d+$/, 'must be a whole number').transform(Number);

const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Repeated param (`?amenities=Pool&amenities=Garage`) or comma list (`?amenities=Pool,Garage`). */
const amenityList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(',')).map((entry) => entry.trim()).filter(Boolean),
  )
  .pipe(z.array(amenitySchema));

/**
 * Strict on purpose. An unknown parameter is rejected rather than ignored, which kills the
 * silent-typo'd-filter bug (`?bed=3` quietly returning unfiltered results) and, more importantly,
 * leaves no room for a future field-selection parameter that could strip attribution.
 */
export const searchRequestSchema = z.strictObject({
  query: z.string().optional(),
  zip: z.string().optional(),
  street: z.string().optional(),
  listingType: z.union([listingTypeSchema, z.literal('all')]).default('all'),
  propertyType: z.union([propertyTypeSchema, z.literal('all')]).default('all'),
  minPrice: queryInt.optional(),
  maxPrice: queryInt.optional(),
  beds: queryInt.optional(),
  baths: queryInt.optional(),
  minSqft: queryInt.optional(),
  neighborhood: z.string().optional(),
  openHouse: queryBoolean.optional(),
  newConstruction: queryBoolean.optional(),
  waterfront: queryBoolean.optional(),
  petFriendly: queryBoolean.optional(),
  amenities: amenityList.optional(),
  sort: z.enum(['recommended', 'newest', 'price-asc', 'price-desc']).default('recommended'),
  page: queryInt.pipe(z.number().int().min(1)).default(1),
  pageSize: queryInt.pipe(z.number().int().min(1).max(PAGE_SIZE_MAX)).default(PAGE_SIZE_DEFAULT),
});

export type SearchRequestInput = z.input<typeof searchRequestSchema>;
export type SearchRequest = z.output<typeof searchRequestSchema>;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec nx test property-contracts` Expected: PASS. If `.default()` on a piped schema
misbehaves, adjust the composition — the assertions are the contract, not this exact expression.

- [ ] **Step 5: Commit**

```bash
git add libs/property-contracts/src/search-request.ts libs/property-contracts/src/search-request.spec.ts
git commit -m "#47 feat(contracts): add the strict search request schema"
```

---

### Task 4: List row and response envelope

**Files:**

- Create: `libs/property-contracts/src/listing-card.ts`
- Test: `libs/property-contracts/src/listing-card.spec.ts`

**Interfaces:**

- Consumes: `./common` schemas; `PAGE_SIZE_DEFAULT` from `./search-request`.
- Produces: `listingCardSchema`, `appliedFiltersSchema`, `listingsEnvelopeSchema`, and types
  `ListingCardRow`, `AppliedFilters`, `ListingsEnvelope`.

- [ ] **Step 1: Write the failing test**

```ts
// libs/property-contracts/src/listing-card.spec.ts
import { listingCardSchema, listingsEnvelopeSchema } from './listing-card';

const row = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  title: 'Sample listing',
  address: null,
  city: 'Alexandria',
  state: 'VA',
  zip: '22314',
  neighborhood: null,
  latitude: null,
  longitude: null,
  price: null,
  status: 'Active',
  listingType: 'sale',
  source: 'internal',
  propertyType: 'Land',
  beds: null,
  baths: null,
  sqft: null,
  lotSqft: 104544,
  yearBuilt: null,
  primaryMedia: null,
  openHouse: null,
  amenities: [],
  featured: false,
  sponsored: false,
  priceReduced: false,
  newConstruction: false,
  isSample: true,
  closePrice: null,
  closeDate: null,
  lastUpdated: '2026-08-01T12:00:00.000Z',
  listingAgentName: null,
  brokerName: 'B',
  brokerPhone: '1',
  brokerEmail: 'b@x',
  officeName: 'O',
  officeBrokerLeadPhone: null,
  officeBrokerLeadEmail: null,
  listedBy: 'B – O',
};

describe('listingCardSchema', () => {
  it('accepts a land parcel with null beds, baths, sqft and price', () => {
    expect(listingCardSchema.safeParse(row).success).toBe(true);
  });

  it('rejects a row missing a nullable key rather than treating it as absent', () => {
    const { beds, ...withoutBeds } = row;
    expect(listingCardSchema.safeParse(withoutBeds).success).toBe(false);
  });

  it('rejects a row missing any attribution field', () => {
    for (const key of ['brokerName', 'brokerPhone', 'brokerEmail', 'officeName', 'listedBy']) {
      const { [key]: _removed, ...partial } = row as Record<string, unknown>;
      expect(listingCardSchema.safeParse(partial).success).toBe(false);
    }
  });

  it('carries no description, no imageUrls and no hasOpenHouse', () => {
    const keys = Object.keys(listingCardSchema.parse(row));
    expect(keys).not.toContain('description');
    expect(keys).not.toContain('imageUrls');
    expect(keys).not.toContain('hasOpenHouse');
  });

  it('carries an exact total and page info on the envelope', () => {
    const envelope = listingsEnvelopeSchema.parse({
      results: [row],
      total: 137,
      page: 1,
      pageSize: 20,
      pageCount: 7,
      appliedFilters: {},
    });
    expect(envelope.total).toBe(137);
    expect(typeof envelope.total).toBe('number');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm exec nx test property-contracts` Expected: FAIL — `Cannot find module './listing-card'`.

- [ ] **Step 3: Implement `listing-card.ts`**

```ts
import { z } from 'zod';
import {
  amenitySchema,
  attributionSchema,
  consumerStatusSchema,
  listingSourceSchema,
  listingTypeSchema,
  mediaSchema,
  openHouseSchema,
  propertyTypeSchema,
} from './common';

/**
 * The flat card projection. Every nullable field is `.nullable()` and never `.optional()`:
 * a `0` for a land parcel's beds asserts a fact that is false (PRD §6.3) and corrupts range
 * predicates, and an omitted key is indistinguishable from null to a JSON client.
 */
export const listingCardSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    // Null when the seller opted out of address display. The coordinates are masked with it —
    // publishing the point re-identifies the address.
    address: z.string().nullable(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
    neighborhood: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    // Nullable ahead of Bright's seller-directed field-level suppression (announced 2026-07-09).
    price: z.number().nullable(),
    status: consumerStatusSchema,
    listingType: listingTypeSchema,
    source: listingSourceSchema,
    propertyType: propertyTypeSchema,
    beds: z.number().int().nullable(),
    baths: z.number().nullable(),
    sqft: z.number().int().nullable(),
    lotSqft: z.number().int().nullable(),
    yearBuilt: z.number().int().nullable(),
    primaryMedia: mediaSchema.nullable(),
    // The soonest UPCOMING occurrence, or null. There is deliberately no unbounded boolean.
    openHouse: openHouseSchema.nullable(),
    amenities: z.array(amenitySchema),
    featured: z.boolean(),
    // Paid placement ranks first under `recommended`; the label is a disclosure obligation.
    sponsored: z.boolean(),
    priceReduced: z.boolean(),
    newConstruction: z.boolean(),
    isSample: z.boolean(),
    closePrice: z.number().nullable(),
    closeDate: z.string().nullable(),
    lastUpdated: z.string(),
  })
  .extend(attributionSchema.shape);

/** Echo of the normalised filter set the server actually applied. */
export const appliedFiltersSchema = z.record(z.string(), z.unknown());

export const listingsEnvelopeSchema = z.object({
  results: z.array(listingCardSchema),
  /** Exact, not an estimate — the client computes pageCount from it. */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
  appliedFilters: appliedFiltersSchema,
});

export type ListingCardRow = z.infer<typeof listingCardSchema>;
export type AppliedFilters = z.infer<typeof appliedFiltersSchema>;
export type ListingsEnvelope = z.infer<typeof listingsEnvelopeSchema>;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec nx test property-contracts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/property-contracts/src/listing-card.ts libs/property-contracts/src/listing-card.spec.ts
git commit -m "#47 feat(contracts): add the list row and response envelope"
```

---

### Task 5: Detail, metadata and error shapes

**Files:**

- Create: `libs/property-contracts/src/listing-detail.ts`
- Create: `libs/property-contracts/src/listings-meta.ts`
- Create: `libs/property-contracts/src/errors.ts`
- Test: `libs/property-contracts/src/listing-detail.spec.ts`
- Test: `libs/property-contracts/src/listings-meta.spec.ts`

**Interfaces:**

- Consumes: `./common`, `./listing-card`.
- Produces: `listingDetailSchema`, `listingsMetaSchema`, `errorBodySchema`, `NOT_FOUND_BODY`, and
  types `ListingDetail`, `ListingsMeta`, `ErrorBody`.

- [ ] **Step 1: Write the failing tests**

```ts
// libs/property-contracts/src/listing-detail.spec.ts
import { listingDetailSchema } from './listing-detail';

const detail = {
  property: {
    id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    propertyType: 'Single Family',
    yearBuilt: 1998,
    lotSqft: 8000,
  },
  unit: null,
  listing: {
    id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
    title: 'Sample',
    address: '100 King St',
    city: 'Alexandria',
    state: 'VA',
    zip: '22314',
    neighborhood: 'Old Town',
    latitude: 38.8,
    longitude: -77.04,
    price: 750000,
    status: 'Active',
    listingType: 'sale',
    source: 'internal',
    propertyType: 'Single Family',
    beds: 3,
    baths: 2,
    sqft: 1800,
    lotSqft: 8000,
    yearBuilt: 1998,
    description: 'Sample listing description.',
    media: [{ url: 'https://x/1.jpg', altText: null }],
    openHouses: [],
    amenities: ['Garage'],
    featured: false,
    sponsored: false,
    priceReduced: false,
    newConstruction: false,
    isSample: true,
    closePrice: null,
    closeDate: null,
    lastUpdated: '2026-08-01T12:00:00.000Z',
    listingAgentName: null,
    brokerName: 'B',
    brokerPhone: '1',
    brokerEmail: 'b@x',
    officeName: 'O',
    officeBrokerLeadPhone: null,
    officeBrokerLeadEmail: null,
    listedBy: 'B – O',
  },
};

describe('listingDetailSchema', () => {
  it('accepts a null unit for a non-subdivided home', () => {
    expect(listingDetailSchema.safeParse(detail).success).toBe(true);
  });

  it('requires the unit key to be present even when null', () => {
    const { unit: _unit, ...withoutUnit } = detail;
    expect(listingDetailSchema.safeParse(withoutUnit).success).toBe(false);
  });

  it('carries description on detail and media as objects', () => {
    const parsed = listingDetailSchema.parse(detail);
    expect(parsed.listing.description).toBe('Sample listing description.');
    expect(parsed.listing.media[0]).toEqual({ url: 'https://x/1.jpg', altText: null });
  });
});
```

```ts
// libs/property-contracts/src/listings-meta.spec.ts
import { listingsMetaSchema } from './listings-meta';

describe('listingsMetaSchema', () => {
  it('allows a null freshness timestamp for an empty dataset', () => {
    const parsed = listingsMetaSchema.parse({
      dataUpdatedAt: null,
      sources: [],
      listingCount: 0,
    });
    expect(parsed.dataUpdatedAt).toBeNull();
  });

  it('requires dataUpdatedAt to be present', () => {
    expect(listingsMetaSchema.safeParse({ sources: [], listingCount: 0 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm exec nx test property-contracts` Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three modules**

```ts
// libs/property-contracts/src/listing-detail.ts
import { z } from 'zod';
import { listingCardSchema } from './listing-card';
import { mediaSchema, openHouseSchema, propertyTypeSchema } from './common';

/** Durable site facts the view drops. Display-suppressed values are NOT re-sourced from here. */
const propertyFactsSchema = z.object({
  id: z.string(),
  propertyType: propertyTypeSchema,
  yearBuilt: z.number().int().nullable(),
  lotSqft: z.number().int().nullable(),
});

/**
 * Present only for a genuinely subdivided building. `unitNumber` is nulled whenever the address
 * was masked — otherwise the suppressed address is reconstructible from zip + unit number.
 */
const unitFactsSchema = z.object({
  id: z.string(),
  unitNumber: z.string().nullable(),
  beds: z.number().int().nullable(),
  baths: z.number().nullable(),
  sqft: z.number().int().nullable(),
});

const listingDetailFieldsSchema = listingCardSchema
  .omit({ primaryMedia: true, openHouse: true })
  .extend({
    description: z.string().nullable(),
    media: z.array(mediaSchema),
    openHouses: z.array(openHouseSchema),
  });

/** The object graph, not a card. `unit: null` means "the offer is the whole property". */
export const listingDetailSchema = z.object({
  property: propertyFactsSchema,
  unit: unitFactsSchema.nullable(),
  listing: listingDetailFieldsSchema,
});

export type ListingDetail = z.infer<typeof listingDetailSchema>;
```

```ts
// libs/property-contracts/src/listings-meta.ts
import { z } from 'zod';
import { listingSourceSchema } from './common';

/**
 * Dataset freshness for the footer, which renders on every route and so cannot depend on a search.
 * `dataUpdatedAt` is MLS feed freshness — never a local write time, never `updated_at`.
 * Null is a real state: with no publishable listings the footer omits the line rather than
 * substituting the current time, which would be fabricated data (PRD §6.3).
 */
export const listingsMetaSchema = z.object({
  dataUpdatedAt: z.string().nullable(),
  sources: z.array(listingSourceSchema),
  listingCount: z.number().int(),
});

export type ListingsMeta = z.infer<typeof listingsMetaSchema>;
```

```ts
// libs/property-contracts/src/errors.ts
import { z } from 'zod';

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(['invalid_request', 'not_found']),
    message: z.string(),
  }),
});

/**
 * The single 404 body. An unknown id, a soft-deleted id and a display-suppressed id must be
 * byte-identical: a distinguishable response is a confirmation oracle that defeats the opt-out.
 */
export const NOT_FOUND_BODY = Object.freeze({
  error: { code: 'not_found', message: 'Listing not found.' },
} as const);

export type ErrorBody = z.infer<typeof errorBodySchema>;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec nx test property-contracts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/property-contracts/src/listing-detail.ts libs/property-contracts/src/listings-meta.ts \
        libs/property-contracts/src/errors.ts libs/property-contracts/src/*.spec.ts
git commit -m "#47 feat(contracts): add detail, metadata and error shapes"
```

---

### Task 6: OpenAPI document builder with a golden snapshot

**Files:**

- Create: `libs/property-contracts/src/openapi.ts`
- Modify: `libs/property-contracts/src/index.ts`
- Test: `libs/property-contracts/src/openapi.spec.ts`

**Interfaces:**

- Consumes: every schema from Tasks 2–5.
- Produces: `toOpenApiDocument(): OpenApiDocument`, re-exported from the package root along with
  every schema and type.

- [ ] **Step 1: Write the failing test**

The path templates must be byte-identical to the gateway route file's `DownstreamPathTemplate`
values that #22 will add — MMLib.SwaggerForOcelot matches on them, and a mismatch leaves the path
untransformed with no error logged.

```ts
// libs/property-contracts/src/openapi.spec.ts
import { toOpenApiDocument } from './openapi';

describe('toOpenApiDocument', () => {
  const doc = toOpenApiDocument();

  it('declares the three listings paths #22 will serve', () => {
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/listings',
      '/listings/meta',
      '/listings/{id}',
    ]);
  });

  it('emits an OpenAPI 3.0 document with no server base path to prefix the paths', () => {
    expect(doc.openapi).toMatch(/^3\.0\./);
    expect(doc.servers).toBeUndefined();
  });

  it('renders nullable fields as nullable rather than as an untyped object', () => {
    const card = doc.components.schemas.ListingCardRow;
    expect(card.properties.beds.nullable).toBe(true);
    expect(card.properties.sqft).not.toEqual({});
  });

  it('publishes no field-selection parameter on the search endpoint', () => {
    const names = doc.paths['/listings'].get.parameters.map((p: { name: string }) => p.name);
    for (const forbidden of ['fields', 'select', 'include', 'omit', 'exclude']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('matches the committed golden document', () => {
    expect(doc).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm exec nx test property-contracts` Expected: FAIL — `Cannot find module './openapi'`.

- [ ] **Step 3: Implement `openapi.ts`**

`target: 'openapi-3.0'` is chosen over the default draft-2020-12 because it emits `nullable: true`
instead of `anyOf: [{…}, {type: "null"}]`. This contract is nullable-heavy by design, and the 3.0
form renders far more legibly in the gateway's aggregated Swagger UI.

```ts
import { z } from 'zod';
import { listingCardSchema, listingsEnvelopeSchema } from './listing-card';
import { listingDetailSchema } from './listing-detail';
import { listingsMetaSchema } from './listings-meta';
import { errorBodySchema } from './errors';
import { searchRequestSchema } from './search-request';

const schema = (value: z.ZodType, io: 'input' | 'output' = 'output') =>
  z.toJSONSchema(value, { target: 'openapi-3.0', io, unrepresentable: 'any' });

/** Query parameters, derived from the request schema so the two cannot drift. */
function searchParameters() {
  const requestJsonSchema = schema(searchRequestSchema, 'input') as {
    properties: Record<string, unknown>;
    required?: string[];
  };
  return Object.entries(requestJsonSchema.properties).map(([name, propertySchema]) => ({
    name,
    in: 'query',
    required: requestJsonSchema.required?.includes(name) ?? false,
    schema: propertySchema,
  }));
}

/**
 * The whole OpenAPI document, derived from the schemas. Never hand-write a parallel spec file:
 * it becomes a second source of truth that drifts from the routes silently.
 *
 * Path templates MUST stay byte-identical to the gateway route file's DownstreamPathTemplate
 * values, or MMLib.SwaggerForOcelot leaves them untransformed and the published spec 404s.
 */
export function toOpenApiDocument() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Cribstop Listings API',
      version: '1.0.0',
      description:
        'Consumer listings search and detail. Every response carries the full broker/office ' +
        'attribution block (NAR 7.58, PRD §6.2); no parameter can omit it. Results are read ' +
        'through a compliance-enforcing view, so seller-suppressed listings are absent rather ' +
        'than redacted. Free-text `query` matches title, address, city, neighborhood and zip — ' +
        'never the description.',
    },
    paths: {
      '/listings': {
        get: {
          operationId: 'searchListings',
          summary: 'Search listings',
          description:
            'Sorted with a deterministic total order, so paging is stable. `listingType=all` ' +
            'covers currently marketed listings and excludes sold; ask for `sold` explicitly.',
          parameters: searchParameters(),
          responses: {
            '200': {
              description: 'A page of listings with an exact total.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ListingsEnvelope' } },
              },
            },
            '400': {
              description: 'Unknown or invalid query parameter.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
          },
        },
      },
      '/listings/meta': {
        get: {
          operationId: 'getListingsMeta',
          summary: 'Dataset freshness',
          description:
            'Callable without running a search. `dataUpdatedAt` is MLS feed freshness, not the ' +
            'time ingestion ran, and is null when nothing is publishable.',
          responses: {
            '200': {
              description: 'Dataset freshness and provenance.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ListingsMeta' } },
              },
            },
          },
        },
      },
      '/listings/{id}': {
        get: {
          operationId: 'getListing',
          summary: 'Listing detail',
          description:
            'Returns the object graph. `unit` is null for a non-subdivided home — meaningful, ' +
            'not missing. Unknown, removed and seller-suppressed listings are indistinguishable.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': {
              description: 'The listing.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ListingDetail' } },
              },
            },
            '404': {
              description: 'No such listing.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        ListingCardRow: schema(listingCardSchema),
        ListingsEnvelope: schema(listingsEnvelopeSchema),
        ListingDetail: schema(listingDetailSchema),
        ListingsMeta: schema(listingsMetaSchema),
        ErrorBody: schema(errorBodySchema),
      },
    },
  };
}

export type OpenApiDocument = ReturnType<typeof toOpenApiDocument>;
```

- [ ] **Step 4: Export everything from the package root**

Replace `libs/property-contracts/src/index.ts`:

```ts
export * from './common';
export * from './search-request';
export * from './listing-card';
export * from './listing-detail';
export * from './listings-meta';
export * from './errors';
export * from './openapi';
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm exec nx test property-contracts` Expected: PASS, and a new snapshot file is written under
`libs/property-contracts/src/__snapshots__/openapi.spec.ts.snap`. **Read the snapshot before
committing it** — it is the published contract. If a field renders as `{}`, that field's schema uses
a construct `toJSONSchema` cannot represent; fix the schema rather than accepting the snapshot.

- [ ] **Step 6: Commit**

```bash
git add libs/property-contracts/src/openapi.ts libs/property-contracts/src/openapi.spec.ts \
        libs/property-contracts/src/index.ts libs/property-contracts/src/__snapshots__
git commit -m "#47 feat(contracts): derive the OpenAPI document from the schemas"
```

---

### Task 7: Wire both consumers and prove the compile-error coupling

**Files:**

- Modify: `apps/services/property-service/package.json`
- Modify: `apps/clients/cribstop/next/package.json`
- Create: `apps/clients/cribstop/next/src/lib/contracts.check.ts`

**Interfaces:**

- Consumes: the package root exports from Task 6.
- Produces: `@cribstop/property-contracts` resolvable from both consumers; a type-check that fails
  when the contract changes.

- [ ] **Step 1: Declare the dependency in both consumers**

Add to the `dependencies` of **both** `apps/services/property-service/package.json` and
`apps/clients/cribstop/next/package.json`:

```json
"@cribstop/property-contracts": "workspace:*"
```

Then:

```bash
pnpm install
```

Do **not** add a `tsconfig` `paths` entry — resolution is the pnpm workspace symlink plus TS project
references. A second alias resolves for `tsc` and then fails at webpack bundle time.

- [ ] **Step 2: Write the conformance file**

This is the acceptance test for the whole runtime decision. It is type-only: it imports with
`import type`, emits no runtime code, and must not touch any component or `lib/types.ts`.

```ts
// apps/clients/cribstop/next/src/lib/contracts.check.ts
/**
 * Type-only conformance assertions against @cribstop/property-contracts.
 *
 * This file exists so that renaming, adding or removing a contract field FAILS
 * `pnpm exec nx type-check cribstop-next` instead of silently shipping a card that stopped
 * rendering an attribution field. It emits no runtime code and deliberately touches no component —
 * reconciling the rendering code with this contract is #24.
 */
import type {
  ListingCardRow,
  ListingDetail,
  ListingsEnvelope,
  ListingsMeta,
} from '@cribstop/property-contracts';

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type _CardKeys = Expect<
  Equals<
    keyof ListingCardRow,
    | 'id'
    | 'title'
    | 'address'
    | 'city'
    | 'state'
    | 'zip'
    | 'neighborhood'
    | 'latitude'
    | 'longitude'
    | 'price'
    | 'status'
    | 'listingType'
    | 'source'
    | 'propertyType'
    | 'beds'
    | 'baths'
    | 'sqft'
    | 'lotSqft'
    | 'yearBuilt'
    | 'primaryMedia'
    | 'openHouse'
    | 'amenities'
    | 'featured'
    | 'sponsored'
    | 'priceReduced'
    | 'newConstruction'
    | 'isSample'
    | 'closePrice'
    | 'closeDate'
    | 'lastUpdated'
    | 'listingAgentName'
    | 'brokerName'
    | 'brokerPhone'
    | 'brokerEmail'
    | 'officeName'
    | 'officeBrokerLeadPhone'
    | 'officeBrokerLeadEmail'
    | 'listedBy'
  >
>;

export type _EnvelopeKeys = Expect<
  Equals<
    keyof ListingsEnvelope,
    'results' | 'total' | 'page' | 'pageSize' | 'pageCount' | 'appliedFilters'
  >
>;

export type _DetailKeys = Expect<Equals<keyof ListingDetail, 'property' | 'unit' | 'listing'>>;

export type _MetaKeys = Expect<
  Equals<keyof ListingsMeta, 'dataUpdatedAt' | 'sources' | 'listingCount'>
>;

/** A land parcel legitimately has no beds/baths/sqft, and #24 must guard before formatting. */
export type _ParcelFieldsAreNullable = Expect<Equals<ListingCardRow['sqft'], number | null>>;

/** The list row must never carry description — it is detail-only. */
export type _NoDescriptionOnCard = Expect<
  Equals<'description' extends keyof ListingCardRow ? true : false, false>
>;
```

- [ ] **Step 3: Verify both consumers type-check**

```bash
pnpm exec nx type-check cribstop-next
pnpm exec nx type-check property-service
```

Expected: both PASS.

- [ ] **Step 4: Prove the coupling by breaking it deliberately**

Temporarily rename `officeBrokerLeadEmail` to `officeBrokerLeadEmailX` in
`libs/property-contracts/src/common.ts`, then:

```bash
pnpm exec nx type-check cribstop-next
```

Expected: **FAIL**, naming the field. **Capture this output — it goes in the PR body.** Then revert
the rename and re-run to confirm it passes again.

- [ ] **Step 5: Verify the lockfile is reconcilable**

```bash
pnpm install --frozen-lockfile
```

Expected: exit 0. Never hand-edit `pnpm-lock.yaml`.

- [ ] **Step 6: Commit**

```bash
git add apps/services/property-service/package.json apps/clients/cribstop/next/package.json \
        apps/clients/cribstop/next/src/lib/contracts.check.ts pnpm-lock.yaml
git commit -m "#47 feat(contracts): consume the contract from both apps with a compile-time check"
```

---

### Task 8: Declare the library in all three build registries

**Files:**

- Modify: `apps/services/property-service/Dockerfile`
- Modify: `apps/clients/cribstop/next/Dockerfile`
- Modify: `skaffold.yaml`

**Interfaces:**

- Consumes: Task 7's `workspace:*` dependencies.
- Produces: both images rebuild when `libs/property-contracts/**` changes.

`tools/ci/affected-images.js` derives the CI image matrix from each Dockerfile's `COPY`/`ADD`
sources. A Dockerfile that depends on a path it never copies will not rebuild when that path changes
— silently.

- [ ] **Step 1: Update `apps/services/property-service/Dockerfile`**

In the **deps** stage, after the existing
`COPY apps/services/property-service/package.json ./apps/services/property-service/`:

```dockerfile
# Every workspace member's manifest must be present for --frozen-lockfile.
COPY libs/property-contracts/package.json ./libs/property-contracts/
```

In the **builder** stage, after
`COPY apps/services/property-service ./apps/services/property-service`:

```dockerfile
COPY libs/property-contracts ./libs/property-contracts
```

Copy the narrow path, not `libs`, so the CI matrix stays narrow while still declaring the
dependency.

- [ ] **Step 2: Update `apps/clients/cribstop/next/Dockerfile`**

Three lines. In the **deps** stage, after `COPY apps/clients/cribstop/next/package.json …`:

```dockerfile
COPY libs/property-contracts/package.json ./libs/property-contracts/
```

In the **builder** stage, alongside the other `COPY --from=deps` node_modules lines:

```dockerfile
# pnpm's isolated layout puts zod under the library's own node_modules, not the root store link.
# Without this, `next build` fails with "Cannot find module 'zod'" from a directory that exists.
COPY --from=deps /app/libs/property-contracts/node_modules ./libs/property-contracts/node_modules
```

In the **builder** stage, alongside `COPY apps/clients/cribstop/next ./apps/clients/cribstop/next`:

```dockerfile
COPY libs/property-contracts ./libs/property-contracts
```

The source is required here because `contracts.check.ts` lives under `src/`, and `next build`
type-checks it.

- [ ] **Step 3: Update `skaffold.yaml`**

Add `libs/property-contracts/**` to `dependencies.paths` for **both** the `property-service` artifact
and the `cribstop-web` artifact. Missing this means the local watch loop silently serves a stale
image whenever the contract changes.

- [ ] **Step 4: Prove the CI matrix narrowing works — this is the acceptance evidence**

Commit first (the tool diffs against `origin/dev`), touching only the library:

```bash
git add apps/services/property-service/Dockerfile apps/clients/cribstop/next/Dockerfile skaffold.yaml
git commit -m "#47 build(contracts): declare the library in both Dockerfiles and skaffold"
node tools/ci/affected-images.js --base=origin/dev \
  --projects="property-service cribstop-next" --explain
```

Expected on **stderr**: `rebuilding (libs/property-contracts/… is an input to …)` for **both**
projects. If either says `skipping — no changed file enters …`, a `COPY` line is wrong or too narrow
— fix the Dockerfile, never special-case the script.

---

### Task 9: Verify the cluster still deploys, and document

**Files:**

- Modify: `apps/services/property-service/CLAUDE.md`
- Modify: `apps/clients/cribstop/CLAUDE.md`

**Interfaces:**

- Consumes: everything above.
- Produces: acceptance evidence (b) and durable notes for the next engineer.

- [ ] **Step 1: Full local validation**

```bash
pnpm run pre-push
```

Expected: exit 0. Fix anything it reports before continuing.

- [ ] **Step 2: Deploy and confirm the pod is healthy**

```bash
pnpm run infra:local:cluster:setup
pnpm run skaffold:services:deploy
```

Expected: exits **0**. Then confirm the pod and its migrate initContainer:

```bash
kubectl get pods -l app=property-service
kubectl describe pod -l app=property-service | grep -A3 "migrate"
```

Expected: pod `Ready 1/1`, migrate initContainer `Completed`.

If the pruned production install fails to resolve `@cribstop/property-contracts`, move the dependency
to `devDependencies` in `apps/services/property-service/package.json` — webpack bundles the library
into `main.js`, so nothing resolves it at runtime — and re-run. Record which form was used in the
PR.

- [ ] **Step 3: Shut down everything started in the background**

```bash
taskkill //F //IM kubectl.exe 2>/dev/null || true
taskkill //F //IM skaffold.exe 2>/dev/null || true
ps -W | grep -E 'skaffold|kubectl' || echo "clean"
```

`pkill` silently does nothing on Windows. Confirm nothing survives.

- [ ] **Step 4: Document the coupling where it will be found**

In `apps/services/property-service/CLAUDE.md`, add a short section: the wire contract lives in
`libs/property-contracts` and is the only definition — do not restate a shape locally; the Dockerfile
must keep its `libs/property-contracts` `COPY` lines or the image goes stale silently.

In `apps/clients/cribstop/CLAUDE.md`, add: `src/lib/contracts.check.ts` is a type-only conformance
file — if a contract change breaks the type-check, reconcile the rendering code rather than editing
the assertions to match.

- [ ] **Step 5: Commit**

```bash
git add apps/services/property-service/CLAUDE.md apps/clients/cribstop/CLAUDE.md
git commit -m "#47 docs(contracts): record the contract coupling in both project guides"
```

---

## Self-review

**Spec coverage.** Every section of the design doc maps to a task: Zod-over-TypeBox → Tasks 2–6;
nullable-always-present → Task 4; no field-selection parameter → Tasks 3 and 6; `description`
detail-only → Tasks 4 and 5; compile-error test without dragging in #24 → Task 7; no `paths` entry →
Task 7 Step 1; `--linter=none` → Task 1; three registries → Task 8; both risks (pruned install,
Alpine/`node_modules`) → Task 9 Step 2 and Task 8 Step 2. Ticket AC "the schemas live here" → Tasks
2–6; "acceptance evidence is not the diff" → Task 8 Step 4 and Task 9 Step 2.

**Type consistency.** `ListingCardRow`, `ListingsEnvelope`, `ListingDetail`, `ListingsMeta`,
`ErrorBody`, `toOpenApiDocument`, `PAGE_SIZE_DEFAULT`, `PAGE_SIZE_MAX`, `NOT_FOUND_BODY` are named
identically in the modules that define them (Tasks 2–6), the index barrel (Task 6 Step 4) and the
conformance file (Task 7). The card key list in Task 7 matches the field list in Task 4
field-for-field.

**Known-unstable details** the implementer should adapt rather than force: the exact `.default()`
composition on piped query params (Task 3 Step 4), and the precise shape `z.toJSONSchema` emits for
enums and unions (Task 6 Step 5). In both cases the assertions are the contract, not the expression.
