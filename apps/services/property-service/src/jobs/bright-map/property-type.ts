import { PropertyType } from '../../seed/constants';

/**
 * Bright `PropertySubType` onto the closed `properties.property_type` vocabulary (#93).
 *
 * `$metadata` declares no `EnumType`s, so this list is built from RESO Data Dictionary standard
 * values observed on the wire, not from a discoverable source. An unmapped value fails closed: the
 * column is `NOT NULL` with a `CHECK`, and guessing a property type is exactly the kind of mapping
 * this ticket is required not to do.
 */
const PROPERTY_SUB_TYPE_MAP: Readonly<Record<string, PropertyType>> = {
  Detached: 'Single Family',
  'Single Family Residence': 'Single Family',
  Condominium: 'Condo',
  Townhouse: 'Townhome',
  Duplex: 'Multi-Family',
  Triplex: 'Multi-Family',
  Quadruplex: 'Multi-Family',
  Land: 'Land',
};

/**
 * Bright leaves `PropertySubType` blank on every `Residential`/`Residential Lease` record on the
 * live test feed (#207) — verified against all 1,216 such staged records on 2026-09-19, none of
 * which carry a `PropertySubType`. `StructureDesignType` is the field Bright actually populates for
 * a residential dwelling's structure, so it is the fallback vocabulary rather than a second guess:
 * still a closed, wire-observed map, still fails closed on anything not listed (parking spaces and
 * "Other" have no safe mapping and stay withheld).
 */
const STRUCTURE_DESIGN_TYPE_MAP: Readonly<Record<string, PropertyType>> = {
  Detached: 'Single Family',
  'Twin/Semi-Detached': 'Single Family',
  'End of Row/Townhouse': 'Townhome',
  'Interior Row/Townhouse': 'Townhome',
  'Unit/Flat/Apartment': 'Condo',
  'Penthouse Unit/Flat/Apartment': 'Condo',
  // #226: Bright's manufactured/mobile dwelling values. 'Other' and blank-on-both stay unmapped —
  // no catch-all.
  Manufactured: 'Manufactured/Mobile',
  'Mobile Pre 1976': 'Manufactured/Mobile',
};

export function mapPropertyType(payload: Readonly<Record<string, unknown>>): PropertyType | null {
  const subType = payload.PropertySubType;
  // A blank PropertySubType falls through to StructureDesignType (#207). A PRESENT-but-unrecognised
  // PropertySubType does NOT fall through: it is an explicit value this map has not reviewed, and
  // falling through would let an unrelated StructureDesignType override a deliberate rejection —
  // e.g. a mobile home with PropertySubType 'Mobile Home' and a StructureDesignType of 'Detached'
  // must stay rejected, not resolve to 'Single Family'.
  if (typeof subType === 'string' && subType.trim().length > 0) {
    return PROPERTY_SUB_TYPE_MAP[subType.trim()] ?? null;
  }
  const structureDesignType = payload.StructureDesignType;
  if (typeof structureDesignType === 'string') {
    return STRUCTURE_DESIGN_TYPE_MAP[structureDesignType.trim()] ?? null;
  }
  return null;
}
