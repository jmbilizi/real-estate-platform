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

export function mapPropertyType(payload: Readonly<Record<string, unknown>>): PropertyType | null {
  const subType = payload.PropertySubType;
  if (typeof subType !== 'string') {
    return null;
  }
  return PROPERTY_SUB_TYPE_MAP[subType.trim()] ?? null;
}
