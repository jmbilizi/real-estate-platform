# Bright MLS day-one verification checklist

This document is owned by the Bright MLS ingestion job (`bright-mls-ingest`, scaffolded in #91). It
exists because the day someone can finally authenticate against Bright is the worst possible day to
be reading a GitHub issue body for a checklist — see #91's acceptance criteria: "a list that lives
only in a GitHub issue body is not where someone debugging a 401 at 9am on the day the keys land
will look."

## How to use this

- **The test credentials were run against the live feed on 2026-09-18 (#163).** Every ticked box
  below carries the answer that run produced, against Bright's **test/staging** feed with an **IDX**
  tier account (`BRIGHTIDXTEST`). An item still marked **(A)** is still an assumption inferred from
  public RESO documentation, and may not be cited as fact anywhere in the codebase, a ticket, or a
  conversation with a stakeholder.
- **Nothing here was run against the production feed.** A test-tier answer is evidence about the
  test tier. Re-run the entitlement items in section 1 and section 5 after the production
  credentials land, and record the answers separately rather than over these.
- **Tick a box only when someone has actually run the call and pasted the result** (into this PR, or
  onto the ticket the item cross-references) — not when the item merely sounds plausible or matches
  the RESO spec in general.
- **If an item comes back different from what is assumed here, that is a product-owner ping — post a
  comment on the relevant cross-referenced ticket — not a quiet local fix.** Several of these
  answers change ticket scope (field counts, geospatial implementation choice, suppression
  boundaries), so a silent correction here can leave a ticket's acceptance criteria wrong without
  anyone noticing.
- **An error is not a capability answer until the query is known to be well formed.** Bright returns
  400 for a malformed query and for an unsupported feature. Before you record "Bright does not
  support X", re-issue the call in correct syntax and paste both attempts. A parser error that names
  part of your own query text — a property that "is not defined in type", where the name is a
  literal you sent — is a syntax fault, not a refusal. (#167, from the geospatial near-miss in
  section 4.)
- **Section 0's `$metadata` pull is the first action, before anything else on this list.** It is
  done: the document is committed at `docs/bright-mls/bright-metadata.xml` with its provenance in
  `docs/bright-mls/README.md`. Read that README before working any later section.

## The one lesson the live run taught: visibility is not access

It is on this list three times over, and each instance cost real time:

1. `Lookup` is advertised in the service document and returns **400 — "User 'BRIGHTIDXTEST' does not
   have permission to access entity set 'Lookup'"**.
2. `BrightProperty.Location` is typed `Edm.GeographyPoint` and Bright answers **"GeographyPolygon
   literals not implemented"**. The type is declared; the operators are not built.
3. The service document advertises **50** entity sets; `$metadata` declares **25**. Half of what is
   advertised has no type definition at all.

So never read a name in `$metadata` or the service document as a capability. Issue the call.

## Which feed am I talking to?

Per the stakeholder ruling recorded on #117 (2026-09-12): there are **two credential sets, never one
promoted across environments.**

- `dev` authenticates against Bright's **test/staging** feed.
- `prod` authenticates against the **licensed production** feed.
- `test` and `local` receive **no Bright credentials at all** and stay on seeded `source='internal'`
  sample rows.

The endpoint identity (token endpoint, service root) is **per-environment configuration on the
CronJob**, not a constant in code. Both pairs were verified on 2026-09-18 and are now set in the
overlays:

| Environment | `BRIGHT_MLS_TOKEN_ENDPOINT`                              | `BRIGHT_MLS_SERVICE_ROOT`                                 |
| ----------- | -------------------------------------------------------- | --------------------------------------------------------- |
| `dev`       | `https://okta.tst.brightmls.com/oauth2/default/v1/token` | `https://bright-reso.tst.brightmls.com/RESO/OData/bright` |
| `prod`      | `https://okta.brightmls.com/oauth2/default/v1/token`     | `https://bright-reso.brightmls.com/RESO/OData/bright`     |
| `test`      | none                                                     | none                                                      |
| `local`     | none                                                     | none                                                      |

The `dev` pair is credential-verified. **The `prod` pair is not.** Its service root was
reachability-checked with no credentials and answers `401 WWW-Authenticate: Bearer`, but its token
path is inferred by symmetry with test: Bright's production Okta org publishes both an org-level
discovery document reporting `/oauth2/v1/token` and a `default` authorization server reporting
`/oauth2/default/v1/token`. We took `default`, because that is what test uses. If the first
production token call returns 404 or `invalid_client`, drop `/default` before suspecting the
credential.

**Do not use `brightmls.test.okta.com`.** It resolves, but Okta serves the wildcard `*.okta.com`,
which matches exactly one label and therefore cannot be valid for a three-label host. A
TLS-inspecting proxy rejects the origin certificate and the connection fails permanently with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`. `okta.tst.brightmls.com` is Bright's custom Okta domain for test
and presents a clean chain. **Never disable TLS verification to get past this** — the token request
carries the OAuth2 client secret, which is why `config.ts` rejects a non-HTTPS endpoint outright.

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
deploy-time decision owned by `infra/deploy-control.yaml`, not a developer convenience. **Locally it
will always report `not_configured`, by design** — `local` has no endpoint pair, so there is nothing
for it to authenticate against. To watch a real run, read the logs of the run the dev schedule
produced (`kubectl logs -l app=bright-mls-ingest --tail=-1`) rather than forcing one.

Each run emits two JSON lines, `run_started` and `run_finished`, correlated by `runId`.

**(V) What we already know and are not re-verifying:** Bright integrates over the **RESO Web API
(OData v4)** with **OAuth2 `client_credentials`** and `@odata.nextLink` server-driven paging, and
exposes **Bright-prefixed resources** (`BrightProperties` = listings, `BrightMembers` = agents,
`BrightOffices` = brokers, `BrightMedia`). Legacy RETS still exists; we are not using it.

## 0. The `$metadata` pull — done 2026-09-18

- [x] Authenticate (OAuth2 `client_credentials`) and record the service root, token endpoint and
      token lifetime.  
       **Answer:** both endpoint pairs are in the table above. `token_type=Bearer`,
      `expires_in=3600` (one hour). The credential may be presented either as a form-encoded body
      (`client_id`/`client_secret`) or as HTTP Basic — both return 200; the job uses the form body.
      `scope` is **optional**: with and without `scope=clientcred` the response reports
      `scope=clientcred`.
- [x] Pull `$metadata` and commit it. Record the advertised OData version.  
       **Answer:** committed at `docs/bright-mls/bright-metadata.xml`, 239,839 bytes, sha256
      `9e05a5a7b8de496823d8fafc4b8bd08782b27e86c9f8a6c412c445e7824bd911`, `OData-Version: 4.0`,
      namespace `BrightMLS.OData.bright`. It hangs off the service root as
      `{serviceRoot}/$metadata`, per OData v4.
- [x] From it, enumerate: every resource we are entitled to, every field per resource, every field
      typed `Edm.GeographyPoint`, and every enumeration.  
       **Answer:** the full entity-set table with keys and field counts is in
      `docs/bright-mls/README.md`. Headlines: **25** entity sets declared (against **50** advertised
      in the service document); `BrightProperties` / type `BrightProperty` / key `ListingKey` /
      **931** fields; exactly one `Edm.GeographyPoint` field, `BrightProperty.Location`; and
      **zero** `EnumType`s.

Discovered fields land in the governed MLS field + lookup registry introduced by #127
(`registerMlsField()` / `registerMlsLookupValue()` — two INSERTs, no migration and no redeploy; an
unregistered lookup value is rejected on upsert so the previous good row keeps publishing;
`is_consumer_displayable` defaults false and `is_address_bearing` defaults true, so an unclassified
field is invisible rather than public). This checklist does not implement that registry — it only
records where the fields discovered here are meant to go.

## 1. Entitlement and the field set — an extensibility question, not a count

- [ ] Which resources are actually licensed for our product tier, as opposed to merely present.
      **Visibility is not access** — spot-check every field the consumer surfaces depend on,
      individually.  
       **Partly answered.** The resource half is done: `BrightProperties`, `BrightMembers`,
      `BrightOffices`, `BrightMedia`, `BrightOpenHouses`, `Deletion`, `City` and `PropertyArea` are
      readable on the IDX test account. `Lookup` is advertised and returns **400 — no permission**.
      The **field-level** spot-check has not been run, and it is the half that matters for #93 and
      #128: a field can be present in `$metadata` and always null for us. Leave this box unticked
      until a consumer-surface field audit exists.
- [ ] (A) Which fields are Bright-local (no Data Dictionary equivalent). These cannot be mapped by
      convention and each needs an explicit decision (#93).
- [ ] (A) Confirm the Data Dictionary version Bright certifies against is 1.7 as believed, and
      whether the payload is standard-plus-local or a renamed superset.  
       **Not answered.** `$metadata` carries no Data Dictionary version annotation, so this stays a
      documentation or contract question. Note the entity-set names are **not** the Data Dictionary
      names (`BrightProperties`, not `Property`), so "renamed superset" is the live hypothesis.
- [x] **Note for whoever runs this: do not treat any field total as a target.** The requirement on
      #127 is that the schema absorbs the full licensed set _whatever it turns out to be_. Report
      the number as a fact; do not turn it into scope.  
       **The number is 931 fields on `BrightProperty`.** It is a fact, not a backlog.

## 2. Protocol capabilities

- [x] `$filter`, `$select`, `$orderby`, `$top`, `$skip` and `$expand` are all permitted for us.  
       **Answer:** `$select`, `$top`, `$skip`, `$count=true`, `$filter` (on `ModificationTimestamp`)
      and `$orderby` all work — so the bandwidth and caching assumptions in #92 and #82 hold.
      **`$expand=Media` does not**: it returns 400, because `BrightProperty` has no `Media`
      navigation property. Media is a separate resource with its own cursor, not an expansion.
- [x] `@odata.nextLink` paging is exhaustible in one run at our volume. Record the server page
      size.  
       **Answer:** `@odata.nextLink` is present and the **default server page size is 1000**. At the
      observed test-feed volume of 174,580 `BrightProperties` that is ~175 requests for a full pass.
      A complete end-to-end pass was not run, and without a known rate limit (section 3) its wall
      time cannot be predicted — #92 must not assume it fits a single CronJob window.
- [x] `$count` is available — needed to reconcile a replication run against the source.  
       **Answer:** `$count=true` works. Totals on the test feed, **all read 2026-09-18**:
      `BrightProperties` **174,580**; `BrightProperties` modified since 2026-09-01 **1,461**;
      `BrightMedia` **3,403,084**; `Deletion` **10,573,704**. Every count in this document is a
      reading with a date, not a fixed property — `BrightProperties` read **174,579** a day later
      (section 4). Never build a reconciliation assertion against a number recorded here.

## 3. Replication — the assumptions #92 is built on

- [x] `ModificationTimestamp` is present, populated and monotonic on every licensed resource.  
       **Answer — and it is NOT uniform.** `BrightProperty` has `ModificationTimestamp` and filters
      on it correctly. **`BrightMedia` does not**: its cursor field is `MediaModificationTimestamp`,
      and a `$filter` on that works. #92 must carry a per-resource cursor field name, not one
      constant. Monotonicity over time was not observed and cannot be from a single run.
- [ ] (A) It is safe as a cursor with `$orderby=ModificationTimestamp asc` — specifically, that the
      service does not backdate it on republish.  
       **Backdating is still unverified** and needs observation over time, not one call. But one
      hard operational finding belongs here now: **`$orderby=ModificationTimestamp asc` with no
      `$filter` times out (>300 s).** The same query with `$filter=ModificationTimestamp gt <t>` in
      front returns in **3.3 s**. #92 must never issue a bare ordered scan — always bound the window
      first.
- [x] Timestamp **ties** occur (they will) and the chosen tiebreak key (`ListingKey`) is stable and
      sortable.  
       **Answer:** the intended cursor query works —
      `$filter=ModificationTimestamp gt <t>&$orderby=ModificationTimestamp asc,ListingKey asc`
      returns 200 in 3.3 s. `ListingKey` is the declared key of `BrightProperty` and is usable as
      the tiebreak.
- [x] Deleted/withdrawn records remain retrievable with a terminal status rather than vanishing.  
       **Answer: they do not vanish.** A `Deletion` resource exists, is readable, is keyed on
      `UniversalKey`, and holds 10,573,704 rows on the test feed. So #92's key-reconciliation pass
      stays **optional** rather than becoming mandatory.
- [ ] **The contractual rate limits** — requests/second, requests/day, concurrency, and the penalty
      for exceeding them.  
       **Not API-discoverable. No rate-limit headers appear on any response** — no `X-Rate-Limit-*`,
      no `Retry-After`. This is a contract question for #33/#117, and the absence of headers means
      #92 cannot back off adaptively either. It must be configuration.
- [ ] Whether a full resync is permitted at all, and any separate limit on it.  
       **Contract question. Not answered.**
- [x] Whether `BrightMedia` is a separate resource with its own cursor and its own limits.  
       **Answer: yes, separate.** Key `MediaKey`, 56 fields, 3,403,084 rows on the test feed, cursor
      field `MediaModificationTimestamp`, and no `$expand` path from a listing. Its _limits_ fall
      under the unanswered rate-limit item above.

## 4. Geospatial — this decides which of two implementations #66 gets

**Decided: #66 takes the PostGIS fallback branch.**

- [x] Does `$metadata` expose a **queryable** `Edm.GeographyPoint` field on the property resource?  
       **Answer: the type is there and the capability is not.** `BrightProperty.Location` is
      `Edm.GeographyPoint` — the only geography-typed field in the whole document — and Bright's
      search engine answers **400, "GeographyPolygon literals not implemented"**. So the fallback
      applies: bounding-box retrieval plus point-in-polygon in our own PostGIS, which is arguably
      the primary path anyway since consumer searches hit `property_db`, not Bright.  
       **Cite that error, not the first one we got.** The 2026-09-18 probe sent a bare
      `POLYGON((...))` and read back
      `"The property 'POLYGON' ... is not defined in type 'BrightMLS.OData.bright.BrightProperty'"`.
      That is the OData parser reading `POLYGON` as a property path because the geography literal
      prefix was missing — a malformed query, not a capability answer. The re-run on 2026-09-19 used
      the correct OData v4 form, `geo.intersects(Location, geography'SRID=4326;POLYGON((...))')`,
      and got the "not implemented" answer. The conclusion is the same; the evidence for it is not.
- [x] Whether `geo.distance` radius filtering is supported.  
       **Answer: no.** `geo.distance(Location, geography'SRID=4326;POINT(-77.03 38.90)') lt 5`
      returns **400, "GeographyPoint literals not implemented"**.
- [x] **Server-side bounding-box filtering works, and it is what makes the fallback cheap.**  
       `BrightProperty.Latitude` and `BrightProperty.Longitude` are `Edm.Double`, so a plain numeric
      `$filter` narrows a window at the source. Verified on 2026-09-19 that it **bounds the result
      set**, not merely that it is accepted — a 200 alone would have proved nothing:

Every row below is `GET BrightProperties?$top=0&$count=true&$filter=<the filter shown>`, so each is
re-runnable verbatim:

| `$filter`                                                                                 | `@odata.count` |
| ----------------------------------------------------------------------------------------- | -------------: |
| _(omitted — no `$filter`)_                                                                |        174,579 |
| `Latitude ge 38.88 and Latitude le 38.92 and Longitude ge -77.05 and Longitude le -77.0`  |            155 |
| `Latitude ge 25.0 and Latitude le 25.2 and Longitude ge -80.3 and Longitude le -80.1`     |              0 |
| `Latitude ge 38.80 and Latitude le 39.00 and Longitude ge -77.12 and Longitude le -76.90` |         14,194 |

**Precision.** All 155 rows of the second box were fetched with
`$select=ListingKey,Latitude,Longitude`. **Zero fell outside it**; observed range 38.88000..38.91972
by -77.04994..-77.00046.

**Recall.** Precision alone would not justify the mandate below — a filter that silently dropped
in-box rows would look identical. Two consistency checks, neither of which is ground truth but both
of which a dropping filter would fail. Splitting the second box at latitude 38.90 gives 29 + 126 =
**155**, exactly the whole. The fourth box geometrically contains the second and returns 14,194
≥ 155. **Do not measure recall by paging a wide box and intersecting**: the server page size is
1000, so an unfollowed `@odata.nextLink` truncates the wider set and manufactures a recall failure
that is not there. That mistake was made once here.

So **#92 and #66 must bound by coordinate on the wire**, never pull a rectangle of rows and discard
most of them locally.

**2,943 listings have no coordinates** — `Latitude eq null` and `Longitude eq null` each return
2,943, against 171,636 for `Latitude ne null`, summing to the 174,579 total. That is 1.7% of the
feed, and `ge`/`le` on a nullable column **excludes** every one of them from every bounding-box
query rather than returning them to be filtered later. The exclusion is correct — the same reasoning
as this service's no-`COALESCE`-on-`beds`/`baths` rule, and a fabricated 0 would place them off West
Africa — but 1.7% of inventory being invisible to area search is a product decision for #66, not an
implementation detail.

**The unfiltered total here is 174,579 and section 2 records 174,580.** Both are correct as
observed: section 2 counted on 2026-09-18 and these rows on 2026-09-19. The readings differ by one
and **the cause was not investigated** — a genuine change in the feed and a difference in how the
two counts were issued are equally consistent with it. Neither is a reconciliation defect, and
neither is a fixed property of the feed. Treat every count in this document as a reading with a
date, not as a target for #92 to match.

- [ ] Any vertex-count or payload-size limit on a polygon filter.  
       **Moot while geography literals are not implemented.** Re-open only if Bright later enables
      geospatial operators.
- [ ] (A) Whether coordinates are suppressed alongside the address for opted-out listings, or
      delivered regardless. **If delivered regardless, our mapper is the only thing standing between
      a suppressed address and a map pin** — #93 and the #48 masking rule both depend on this
      answer.  
       **Not answered.** It needs a suppressed listing in the response data, which section 6 covers.

## 5. Lookups, agents, brokers, geography

- [x] Whether a `Lookup` resource (and/or a field-metadata resource) is exposed, or whether
      enumerations are only discoverable from `$metadata`.  
       **Answer: neither route works today.** `$metadata` contains **zero** `EnumType`s, and
      `Lookup` — advertised in the service document — returns **400, "User 'BRIGHTIDXTEST' does not
      have permission to access entity set 'Lookup'"**. Enumerations are currently
      **undiscoverable**. #130 must either obtain `Lookup` entitlement or derive vocabularies from
      observed values. Whether the entitlement can be added is a contract question on #33/#117.
- [x] `BrightMembers` and `BrightOffices` are licensed and readable. Record their key fields.  
       **Answer:** both readable on the IDX test account. `BrightMembers` / `BrightMember` /
      `MemberKey` / 86 fields. `BrightOffices` / `BrightOffice` / `OfficeKey` / 75 fields. Whether
      they are separately licensed, and their relationship to the listing's agent/office fields, is
      not established — #129 needs that.
- [ ] Whether the enumerations are open or closed, and their update cadence.  
       **Unanswerable while `Lookup` is unreadable.** This is exactly the scenario #127's registry
      exists to survive.
- [ ] **"Geographies" has no RESO analog and is ours to model**, not an endpoint to consume. Record
      the permitted values of the property geography fields — `City`, `PostalCode`,
      `CountyOrParish`, `SubdivisionName`, `MLSAreaMajor`/`MLSAreaMinor`.  
       **Blocked on the same `Lookup` 400.** Partial alternative: `City` (7 fields), `CityZipCode`
      (8), `PropertyArea` (5) and `Subdivision` (9) are separate readable entity sets, so some of
      this vocabulary may be reachable as data rather than as an enumeration. #81 and #130 should
      try that route.

## 6. Address-bearing content — the input to the default-deny suppression classification

- [ ] (A) Sample **real values** (not schemas) from every field family that can carry an address, so
      the classification (#53) is based on what the feed actually sends: `UnparsedAddress`, the
      parsed street components (`StreetNumber`, `StreetNumberNumeric`, `StreetDirPrefix`,
      `StreetName`, `StreetSuffix`, `StreetDirSuffix`), `UnitNumber`, `Directions`, `CrossStreet`,
      `PublicRemarks`, `ShowingInstructions`, `BrightMedia` captions / `ShortDescription`,
      `VirtualTourURLUnbranded`, `ParcelNumber` / `TaxParcelLetter` (an APN resolves to an address
      through public records), `SubdivisionName` combined with lot/block, `PostalCodePlus4` (narrows
      to a block face), and `Latitude`/`Longitude`.  
       **Not run.** The 2026-09-18 probe read counts and schema only, never record content. This is
      the highest-value remaining technical item: it also answers the coordinate-suppression
      question in section 4.

## Contractual, not technical

Listed only so nobody assumes a successful API call answered them, and the live run confirmed that
none of them is API-discoverable. These belong to #33/#117: the permitted display statuses, the
solds display-delay window length, required attribution fields, the takedown SLA, the Clear
Cooperation position, the exact field-level suppression semantics, which of the 931 `BrightProperty`
fields are licensed for IDX display as opposed to merely present, the contractual rate limits,
whether a full resync is permitted, and whether `Lookup` access can be added to the IDX entitlement.

## Where to record the answers

- Tick the box **here**, in a PR against this file, once an item has actually been run.
- Put the **substantive answer** (the value, the sample, the confirmed/denied assumption) on the
  ticket that depends on it — #92 (replication), #93 (mapping), #127 (field/lookup registry), #66
  (geospatial), #81 (place filters), #48 (masking), #53 (suppression schema), #102 (hostnames), #33
  (licence), or #117 (credential provisioning) — not only in this file. This file tracks that the
  verification happened; the owning ticket is where the answer changes scope.
