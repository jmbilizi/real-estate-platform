# Bright MLS — the committed reference captures

Two verbatim responses from Bright's RESO Web API:

- `bright-metadata.xml` — the OData v4 CSDL document from `{serviceRoot}/$metadata`.
- `service-document.json` — the service document from `{serviceRoot}/`, which lists the entity sets
  Bright advertises. It is committed because the gap between what it advertises and what `$metadata`
  describes is itself a finding, and a finding nobody can re-check is a rumour.

They are committed so #92, #93, #127, #129 and #130 diff against one fixed version instead of
re-fetching, and so a schema change arrives as a reviewable diff rather than as a surprise at
runtime. Day-one checklist section 0 requires the first.

## Provenance

| Item            | Value                                                              |
| --------------- | ------------------------------------------------------------------ |
| Fetched         | 2026-09-18                                                         |
| Environment     | Bright **TEST/STAGING** feed (the `dev` endpoint pair)             |
| Service root    | `https://bright-reso.tst.brightmls.com/RESO/OData/bright`          |
| Account tier    | `BRIGHTIDXTEST` — an **IDX** tier test account                     |
| Bytes           | 239,839                                                            |
| sha256          | `9e05a5a7b8de496823d8fafc4b8bd08782b27e86c9f8a6c412c445e7824bd911` |
| `OData-Version` | `4.0`                                                              |
| Namespace       | `BrightMLS.OData.bright`                                           |

`service-document.json`: fetched in the same session from the same service root, 2,406 bytes, sha256
`6226aa32569df8c3c9d4ef25cdd32e9ebcb2b271628abfe1fe4491d86e3a654d`, 50 entity sets.

The production feed's document has **not** been fetched. Do not assume the two are identical, and do
not assume an IDX account sees what a fuller tier sees. Record a production fetch as a separate
section here rather than overwriting this one.

The sha256 above is over the **raw response bytes**, because that is what the ingestion job hashes
and logs. `.gitattributes` therefore marks both captures `-text`, so no line-ending normalisation
can make the committed file and the wire disagree and report a drift that did not happen. Keep them
byte-exact: never reformat or pretty-print either file.

Re-fetch with one authenticated `GET {serviceRoot}/$metadata` and one `GET {serviceRoot}/`. Replace
both files in place, keeping the filenames, so the change reads as a diff. Update the table above in
the same commit.

## What this document does and does not settle

**It declares 25 entity sets. The service document advertises 50.** `service-document.json` beside
it is that service document, captured in the same session, so the comparison is reproducible rather
than a remembered number — re-fetch both together. The 25 below are the only ones with an entity
type in `$metadata`; the other 25 — including `Lookup`, `History`, `PublicRecord`, `RelatedLookup`
and `ResoRule` — are advertised with no type definition here at all. Reaching one of those means
discovering its shape from a live response, not from this file.

Entity sets declared here, with key and field count:

| Entity set          | Entity type         | Key                    | Fields |
| ------------------- | ------------------- | ---------------------- | -----: |
| `BrightProperties`  | `BrightProperty`    | `ListingKey`           |    931 |
| `BrightMembers`     | `BrightMember`      | `MemberKey`            |     86 |
| `BrightOffices`     | `BrightOffice`      | `OfficeKey`            |     75 |
| `BrightMedia`       | `BrightMedia`       | `MediaKey`             |     56 |
| `SysAgentMedia`     | `SysAgentMedia`     | `SysMediaKey`          |     28 |
| `SysOfficeMedia`    | `SysOfficeMedia`    | `SysMediaKey`          |     28 |
| `Unit`              | `Unit`              | `UnitTypeKey`          |     25 |
| `BrightOpenHouses`  | `BrightOpenHouse`   | `OpenHouseKey`         |     24 |
| `Room`              | `Room`              | `RoomKey`              |     19 |
| `GreenVerification` | `GreenVerification` | `GreenVerificationKey` |     13 |
| `PartyPermissions`  | `PartyPermissions`  | `PartyPermKey`         |      9 |
| `Subdivision`       | `Subdivision`       | `LoSubdivisionKey`     |      9 |
| `SysPartyLicense`   | `SysPartyLicense`   | `SysPartyLicenseKey`   |      9 |
| `BuildingName`      | `BuildingName`      | `BldgNameKey`          |      8 |
| `CityZipCode`       | `CityZipCode`       | `CityZipCodeKey`       |      8 |
| `Team`              | `Team`              | `TeamKey`              |      8 |
| `City`              | `City`              | `CtyCityKey`           |      7 |
| `School`            | `School`            | `SchoolKey`            |      7 |
| `TeamMember`        | `TeamMember`        | `TeamMemberKey`        |      7 |
| `SchoolDistrict`    | `SchoolDistrict`    | `SchoolDistrictKey`    |      6 |
| `SchoolElementary`  | `SchoolElementary`  | `SchoolKey`            |      6 |
| `SchoolHigh`        | `SchoolHigh`        | `SchoolKey`            |      6 |
| `SchoolMiddle`      | `SchoolMiddle`      | `SchoolKey`            |      6 |
| `Deletion`          | `Deletion`          | `UniversalKey`         |      5 |
| `PropertyArea`      | `PropertyArea`      | `PropAreaKey`          |      5 |

Three facts worth reading off this file before it costs someone a day:

- **The property resource is `BrightProperties`, not `Property`.** The plain RESO name does not
  exist on this feed and returns 404. Field totals are a fact to record, never a target — see #127.
- **The document contains zero `EnumType`s.** Enumerations are not discoverable from it. The
  `Lookup` resource is the documented alternative and this account cannot read it (400, "User
  'BRIGHTIDXTEST' does not have permission"), so enumerations are currently undiscoverable. #130
  depends on this.
- **`BrightProperty.Location` is the one `Edm.GeographyPoint` field in the whole document, and the
  operators over it are not built.** With the correct OData v4 literal,
  `geo.intersects(Location, geography'SRID=4326;POLYGON((...))')` returns 400 **"GeographyPolygon
  literals not implemented"**, and `geo.distance` the same for `GeographyPoint`. A bare
  `POLYGON((...))` instead returns a misleading "property not defined" parse error — do not cite
  that one. The type's presence is not a capability, so #66 takes the PostGIS fallback. `Latitude`
  and `Longitude` are `Edm.Double` and a numeric `$filter` over them works, so the bounding-box half
  of that fallback still runs on Bright's side.
