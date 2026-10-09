/**
 * The `$select` list for every page the sync worker reads (#338).
 *
 * A full `BrightProperties` record is about 25 KB (931 fields). The mapper reads the fields below,
 * so the worker asks for these only. `select.spec.ts` runs the mapper over recording proxies and
 * fails when the mapper reads a field this list does not carry.
 */
export const BRIGHT_SYNC_SELECT: readonly string[] = Object.freeze([
  'ListingKey',
  'ListingId',
  'ModificationTimestamp',
  'StandardStatus',
  'PropertyType',
  'PropertySubType',
  'StructureDesignType',
  'ListPrice',
  'ClosePrice',
  'CloseDate',
  // #391. The list date and current-period days-on-market. `ListingContractDate`/`OnMarketDate`/
  // `OriginalEntryTimestamp` are declared in `$metadata` but are null on every sampled record
  // (production feed, 2026-09-27) — `MLSListDate` is the field this MLS actually populates.
  'MLSListDate',
  // #424. The date a Coming Soon record goes active — 100% filled on 200 sampled Coming Soon
  // records (production feed, 2026-09-28). `MLSListDate` above is the date the record ENTERED
  // Coming Soon, not the date it goes active; this is the field that answers that question.
  'ExpectedOnMarketDate',
  // #459. Only a same-day, non-midnight value is a list time. See `derivePreciseListedAt`.
  'StatusChangeTimestamp',
  'DaysOnMarket',
  'UnparsedAddress',
  'StreetNumber',
  'StreetDirPrefix',
  'StreetName',
  'StreetSuffix',
  'StreetDirSuffix',
  'UnitNumber',
  'City',
  'StateOrProvince',
  'PostalCode',
  'SubdivisionName',
  'Latitude',
  'Longitude',
  'BedroomsTotal',
  'BathroomsFull',
  'BathroomsHalf',
  'LivingArea',
  'LotSizeSquareFeet',
  'YearBuilt',
  'PublicRemarks',
  'ListPictureURL',
  'InternetEntireListingDisplayYN',
  'InternetAddressDisplayYN',
  'ListAgentFullName',
  'ListAgentOfficePhone',
  'ListOfficeKey',
  'ListOfficeName',
  'ListOfficePhone',
  'ListOfficeEmail',
  // #564. Detail-page facts. See `bright-map/map-detail.ts`.
  'TaxAnnualAmount',
  'TaxYear',
  'AssociationFee',
  'AssociationFeeFrequency',
  'VirtualTourURLUnbranded',
  'ListAgentPreferredPhone',
  'ListAgentDirectPhone',
  'ListAgentEmail',
  'ParkingFeatures',
  'Heating',
  'Cooling',
  'Appliances',
  'Basement',
  'Flooring',
  'InteriorFeatures',
  'ExteriorFeatures',
]);
