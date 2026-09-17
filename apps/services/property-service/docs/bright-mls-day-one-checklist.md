# Bright MLS day-one verification checklist

This document is owned by the Bright MLS ingestion job (`bright-mls-ingest`, scaffolded in #91). It
exists because the day someone can finally authenticate against Bright is the worst possible day to
be reading a GitHub issue body for a checklist — see #91's acceptance criteria: "a list that lives
only in a GitHub issue body is not where someone debugging a 401 at 9am on the day the keys land
will look."

## How to use this

- **As of 2026-09-13, nothing in this document has been tested against the live Bright MLS feed.**
  Bright's developer portal is login-gated (verified 2026-09-13: both `developer.brightmls.com` and
  `brightmls.portal.swaggerhub.com` return only a "Log in" prompt), so every item marked **(A)**
  below is an assumption inferred from public RESO documentation and secondary sources. Nothing
  marked (A) may be cited as fact anywhere in the codebase, a ticket, or a conversation with a
  stakeholder until it has actually been run against the live feed.
- **Tick a box only when someone has actually run the call and pasted the result** (into this PR, or
  onto the ticket the item cross-references) — not when the item merely sounds plausible or matches
  the RESO spec in general.
- **If an item comes back different from what is assumed here, that is a product-owner ping — post a
  comment on the relevant cross-referenced ticket — not a quiet local fix.** Several of these
  answers change ticket scope (field counts, geospatial implementation choice, suppression
  boundaries), so a silent correction here can leave a ticket's acceptance criteria wrong without
  anyone noticing.
- **Section 0's `$metadata` pull is the first action, before anything else on this list.** One
  authenticated call settles geospatial support, the real resource list, and most of the field
  question at once, and every later item is cheaper to verify once that document is in hand.

## Which feed am I talking to?

Per the stakeholder ruling recorded on #117 (2026-09-12): there are **two credential sets, never one
promoted across environments.**

- `dev` authenticates against Bright's **test/staging** feed.
- `prod` authenticates against the **licensed production** feed.
- `test` and `local` receive **no Bright credentials at all** and stay on seeded `source='internal'`
  sample rows.

The endpoint identity (token endpoint, service root) is **per-environment configuration on the
CronJob**, not a constant in code — see #91's acceptance criteria and Implementation Plan item 6.
**Every run logs the endpoint HOST it authenticated against** (never the credential), specifically
so that a test-data credential accidentally running in production — or the reverse — is visible in
the first log line of the run rather than inferred later from wrong-looking data.

The job's environment variables are:

- `BRIGHT_MLS_TOKEN_ENDPOINT` — per-environment config on the CronJob
- `BRIGHT_MLS_SERVICE_ROOT` — per-environment config on the CronJob
- `BRIGHT_MLS_CLIENT_ID` — from the `bright-mls-secret` Kubernetes Secret
- `BRIGHT_MLS_CLIENT_SECRET` — from the `bright-mls-secret` Kubernetes Secret

A value still equal to the Git placeholder `StrongBase64Password` is treated as **not configured** —
the job logs a loud, distinguishable "credentials not configured" completion rather than crash
looping or silently succeeding. See #117 for the human runbook that provisions the real values per
environment, and #33 for the licence/credential-delivery ticket those values come from.

**The job already does the first half of section 0 for you.** Once credentials resolve, a run
authenticates (OAuth2 `client_credentials`) and issues `GET {serviceRoot}/$metadata`, then logs the
endpoint hosts, the advertised `OData-Version`, the document's byte length and its SHA-256. That is
a connectivity probe and nothing more — it parses nothing and keeps nothing, because replication is
#92 and mapping is #93. So the fastest way to start this list is to watch one run:

```bash
pnpm run infra:local:cronjob:trigger -- bright-mls-ingest
```

That wrapper creates the Job, waits for it, prints its logs and exits with the job's real outcome.
It is local-cluster-only on purpose: triggering an ingestion run against dev or prod is a
deploy-time decision owned by `infra/deploy-control.yaml`, not a developer convenience. To watch a
run in dev, read the logs of the run the schedule produced
(`kubectl logs -l app=bright-mls-ingest --tail=-1`) rather than forcing one.

Each run emits two JSON lines, `run_started` and `run_finished`, correlated by `runId`. Saving the
`$metadata` document itself into the repo is still a human action — see section 0.

**(V) What we already know and are not re-verifying:** Bright integrates over the **RESO Web API
(OData v4)** with **OAuth2 `client_credentials`**, `@odata.nextLink` server-driven paging, against
**Data Dictionary 1.7**, and exposes **Bright-prefixed resources** (`BrightMembers` = agents,
`BrightOffices` = brokers, `BrightMedia`) alongside standard ones. Legacy RETS still exists; we are
not using it. **Geospatial querying is explicitly outside RESO Web API Core's scope**, so it is not
a certification guarantee — see section 4.

## 0. The `$metadata` pull — do this first, before any mapping work

One authenticated `GET {serviceRoot}/$metadata` settles geospatial support, the real resource list,
and most of the field question in a single call. It is the highest-value first action of the entire
integration, and everything below is cheaper once it is in hand. **Save the document into the repo**
so later tickets diff against it rather than re-fetching.

- [ ] Authenticate (OAuth2 `client_credentials`) and record the service root, token endpoint and
      token lifetime.
- [ ] Pull `$metadata` and commit it. Record the advertised OData version.
- [ ] From it, enumerate: every resource we are entitled to, every field per resource, every field
      typed `Edm.GeographyPoint`, and every enumeration.

Discovered fields land in the governed MLS field + lookup registry introduced by #127
(`registerMlsField()` / `registerMlsLookupValue()` — two INSERTs, no migration and no redeploy; an
unregistered lookup value is rejected on upsert so the previous good row keeps publishing;
`is_consumer_displayable` defaults false and `is_address_bearing` defaults true, so an unclassified
field is invisible rather than public). This checklist does not implement that registry — it only
records where the fields discovered here are meant to go.

## 1. Entitlement and the field set — an extensibility question, not a count

- [ ] (A) Which resources are actually licensed for our product tier, as opposed to merely present.
      Bright's metadata is reported **not to be role-based**, so a resource or field can appear in
      `$metadata` and still be unqueryable or always null for us. **Visibility is not access** —
      spot-check every field the consumer surfaces depend on, individually.
- [ ] (A) Which fields are Bright-local (no Data Dictionary equivalent). These cannot be mapped by
      convention and each needs an explicit decision (#93).
- [ ] (A) Confirm the Data Dictionary version Bright certifies against is 1.7 as believed, and
      whether the payload is standard-plus-local or a renamed superset.
- [ ] **Note for whoever runs this: do not treat any field total as a target.** The requirement on
      #127 is that the schema absorbs the full licensed set _whatever it turns out to be_. Report
      the number as a fact; do not turn it into scope.

## 2. Protocol capabilities

- [ ] (A) `$filter`, `$select`, `$orderby`, `$top`, `$skip` and `$expand` are all permitted for us.
      `$select` in particular: if it is **not** supported, every response is a full payload and the
      bandwidth and caching assumptions in #92 and #82 change.
- [ ] (A) `@odata.nextLink` paging is exhaustible in one run at our volume. Record the server page
      size.
- [ ] (A) `$count` is available — needed to reconcile a replication run against the source.

## 3. Replication — the assumptions #92 is built on

- [ ] (A) `ModificationTimestamp` is present, populated and monotonic on every licensed resource.
- [ ] (A) It is safe as a cursor with `$orderby=ModificationTimestamp asc` — specifically, that the
      service does not backdate it on republish.
- [ ] (A) Timestamp **ties** occur (they will) and the chosen tiebreak key (`ListingKey`) is stable
      and sortable. This is the classic silent-data-loss trap and is worth a deliberate test.
- [ ] (A) Deleted/withdrawn records remain retrievable with a terminal status rather than vanishing.
      If they vanish, #92's key-reconciliation pass becomes mandatory rather than optional, and the
      takedown SLA depends on it.
- [ ] (A) **The contractual rate limits** — requests/second, requests/day, concurrency, and the
      penalty for exceeding them. #92 treats these as configuration with placeholders; replace the
      placeholders with the real numbers and record where they came from.
- [ ] (A) Whether a full resync is permitted at all, and any separate limit on it.
- [ ] (A) Whether `BrightMedia` is a separate resource with its own cursor and its own limits.

## 4. Geospatial — this decides which of two implementations #66 gets

- [ ] (A) Does `$metadata` expose a **queryable** `Edm.GeographyPoint` field on Property? If yes,
      server-side `geo.intersects(<field>, POLYGON((...)))` with closed, double-parenthesised WKT
      rings is available. **If no, that is not a blocker** — the fallback is bounding-box retrieval
      plus point-in-polygon in our own PostGIS, which is arguably the primary path anyway since
      consumer searches hit `property_db`, not Bright. Record which branch applies on #66.
- [ ] (A) Whether `geo.distance` radius filtering is supported.
- [ ] (A) Any vertex-count or payload-size limit on a polygon filter.
- [ ] (A) Whether coordinates are suppressed alongside the address for opted-out listings, or
      delivered regardless. **If delivered regardless, our mapper is the only thing standing between
      a suppressed address and a map pin** — #93 and the #48 masking rule both depend on this
      answer.

## 5. Lookups, agents, brokers, geography

- [ ] (A) Whether a `Lookup` resource (and/or a field-metadata resource) is exposed, or whether
      enumerations are only discoverable from `$metadata`.
- [ ] (A) `BrightMembers` and `BrightOffices` are licensed and readable, and whether they are
      separately licensed or included. Record their key fields and their relationship to the
      listing's agent/office fields.
- [ ] (A) Whether the enumerations are open or closed, and their update cadence. A closed
      enumeration that changes without notice is the scenario #127's registry exists to survive.
- [ ] **"Geographies" has no RESO analog and is ours to model**, not an endpoint to consume. Record
      the permitted values of the Property geography fields — `City`, `PostalCode`,
      `CountyOrParish`, `SubdivisionName`, `MLSAreaMajor`/`MLSAreaMinor` — from the Lookup resource
      or `$metadata`. That value set is the input to #81's structured place filters and to any later
      area vocabulary.

## 6. Address-bearing content — the input to the default-deny suppression classification

- [ ] (A) Sample **real values** (not schemas) from every field family that can carry an address, so
      the classification (#53) is based on what the feed actually sends: `UnparsedAddress`, the
      parsed street components (`StreetNumber`, `StreetNumberNumeric`, `StreetDirPrefix`,
      `StreetName`, `StreetSuffix`, `StreetDirSuffix`), `UnitNumber`, `Directions`, `CrossStreet`,
      `PublicRemarks`, `ShowingInstructions`, `BrightMedia` captions / `ShortDescription`,
      `VirtualTourURLUnbranded`, `ParcelNumber` / `TaxParcelLetter` (an APN resolves to an address
      through public records), `SubdivisionName` combined with lot/block, `PostalCodePlus4` (narrows
      to a block face), and `Latitude`/`Longitude`.

## Contractual, not technical

Listed only so nobody assumes a successful API call answered them. These belong to #33/#117:
permitted display statuses, the solds display-delay window length, required attribution fields, the
takedown SLA, the Clear Cooperation position, and the exact field-level suppression semantics.

## Where to record the answers

- Tick the box **here**, in a PR against this file, once an item has actually been run.
- Put the **substantive answer** (the value, the sample, the confirmed/denied assumption) on the
  ticket that depends on it — #92 (replication), #93 (mapping), #127 (field/lookup registry), #66
  (geospatial), #81 (place filters), #48 (masking), #53 (suppression schema), #102 (hostnames), #33
  (licence), or #117 (credential provisioning) — not only in this file. This file tracks that the
  verification happened; the owning ticket is where the answer changes scope.
