import { Queryable } from './write';

/**
 * THE ONLY MODULE THAT WRITES THE MLS ATTRIBUTE MODEL — `mls_fields`, `mls_lookup_values`,
 * `listing_attributes` and `property_attributes` (#127).
 *
 * WHY IT IS NOT IN `write.ts`. That module's containment exists for one specific reason: the dwelling
 * snapshot on `listings` is drift-capable and no database constraint can assert it. The invariant here
 * is a different one — governance and fail-closed vocabulary — and it IS expressible in the database
 * (migration `1785801600013` enforces every rule below with composite foreign keys). Two unrelated
 * invariants under one header make both easier to misread, so the containment is mirrored rather than
 * merged: `seed.spec.ts` asserts that this module is the only writer of these four tables, and that
 * this module never writes `listings`.
 *
 * ── FAIL CLOSED, BUT DO NOT ABORT THE BATCH ───────────────────────────────────────────────────────
 *
 * An unregistered field or value is rejected: the attribute is not stored. The database would reject
 * it anyway (the FKs make that structural), but this module detects it FIRST and returns it as a
 * structured rejection instead of letting a constraint violation abort the surrounding transaction.
 * That difference is the whole point, and it is the same reasoning `listing_statuses` records for
 * unknown statuses: a single unrecognised vocabulary value must not take down the ingest of a whole
 * batch, because the fallback is that we keep publishing yesterday's rows.
 *
 * These rejections are diagnostics for an ingestion run to record (#93 owns where that lives and for
 * how long). This module deliberately persists none of them — a rejected value has by definition not
 * been reviewed, and writing unreviewed feed text into a durable table is the thing the attribute
 * model exists to prevent.
 *
 * ── A FIELD IS PROCESSED ALL-OR-NOTHING ───────────────────────────────────────────────────────────
 *
 * `putListingAttributes` REPLACES the stored set for each field it mentions, because an upsert cannot
 * express a value the feed has stopped sending (the same argument `deleteSampleData` records for the
 * seed). But if any value for a field fails to resolve, that field is skipped entirely and its
 * existing rows are left alone — a half-applied set would be worse than a stale one, and deleting good
 * values because a NEW one is unregistered would turn a governance gap into data loss.
 */

/** The typed-value discriminator, mirroring `mls_fields.data_type`. There is deliberately no text. */
export type MlsDataType = 'integer' | 'decimal' | 'boolean' | 'date' | 'timestamp' | 'lookup';

/** Which entity a field attaches to, mirroring `mls_fields.scope`. */
export type MlsFieldScope = 'listing' | 'property';

/**
 * The closed vocabulary for `mls_fields.address_classification` (#128). NULL — omitted at
 * registration — is a valid fourth state meaning "not yet reviewed", and is treated identically to
 * every member here except `not_address_bearing`: see `isAddressBearingClassification()` in
 * `../listings/suppression`, the one function that decides it.
 */
export type AddressClassification =
  | 'carries_address'
  | 're_identifies_address'
  | 'free_text_may_contain_address'
  | 'not_address_bearing';

/** The natural key of a registered field. Market-agnostic: the system is part of the identity. */
export interface MlsFieldKey {
  originatingSystem: string;
  resoResource: string;
  fieldName: string;
}

export interface MlsFieldRegistration extends MlsFieldKey {
  /** The RESO Data Dictionary name, or null when the field is local to the originating system. */
  resoStandardName: string | null;
  dataType: MlsDataType;
  scope: MlsFieldScope;
  unitOfMeasure?: string | null;
  /**
   * The default-deny address classification (#128). Omitted means NOT YET REVIEWED — stored as
   * NULL — and `mls_fields.is_address_bearing` is derived from this value rather than passed
   * separately, so the two can never disagree (`mls_fields_classification_matches_bearing`). Pass
   * `'not_address_bearing'` only as a reviewed decision, never to make an ingest run quieter.
   */
  addressClassification?: AddressClassification | null;
  notes?: string | null;
}

export interface MlsLookupValueRegistration {
  fieldId: string;
  /** The value exactly as the feed presents it — this is the match target on ingest. */
  value: string;
  label: string;
  resoStandardValue?: string | null;
  sortOrder?: number;
}

/** One attribute as an ingestion mapper has it: a field key and the raw feed value. */
export interface MlsAttributeInput extends MlsFieldKey {
  /**
   * The raw value from the feed, coerced here against the field's REGISTERED type rather than a type
   * the caller restates — a caller-supplied type could contradict the registry, and then only one of
   * the two would be right.
   *
   * An array is a multi-valued lookup (RESO Features / Views / Styles). `null` and `undefined` mean
   * "the feed sent no value", which clears the field rather than rejecting it.
   */
  value: unknown;
  /** Feed freshness for this attribute, distinct from the row's `updated_at`. */
  sourceModificationTimestamp?: string | null;
}

export type MlsRejectionReason =
  | 'unregistered_field'
  | 'retired_field'
  | 'wrong_scope'
  | 'type_mismatch'
  | 'unregistered_value'
  | 'retired_value';

export interface MlsAttributeRejection extends MlsFieldKey {
  reason: MlsRejectionReason;
  /**
   * The offending value, truncated — enough to register a vocabulary token, too short to carry a
   * marketing remark. The truncation is a deliberate guard rather than a display nicety: a value long
   * enough to be prose is, by that fact, not a lookup token, and an operator reviewing this does not
   * need the rest of it to decide.
   */
  value: string | null;
}

export interface MlsAttributeWriteResult {
  /** Attribute rows written (inserted or updated). */
  stored: number;
  /** Attribute rows removed because the feed stopped sending them. */
  removed: number;
  rejected: MlsAttributeRejection[];
}

/** See `MlsAttributeRejection.value`. */
const MAX_REJECTED_VALUE_LENGTH = 120;

function describeValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof text !== 'string') {
    return null;
  }
  return text.length > MAX_REJECTED_VALUE_LENGTH
    ? `${text.slice(0, MAX_REJECTED_VALUE_LENGTH)}…`
    : text;
}

/**
 * Registers a field, or returns the id of the one already registered under this natural key.
 *
 * Idempotent so a `$metadata` re-pull (#91) is a no-op rather than a conflict. The DO UPDATE touches
 * only the descriptive columns: it deliberately does NOT re-assert `address_classification` or
 * `is_address_bearing`, so a human's reviewed declassification is never silently reverted by the
 * next metadata sync. Nor does it touch `data_type` or `scope` — attribute rows already reference
 * those through composite foreign keys, so changing one is a data migration, not an upsert.
 */
export async function registerMlsField(
  client: Queryable,
  field: MlsFieldRegistration,
): Promise<string> {
  // `?? null` rather than a bare pass-through: an omitted classification is the "not yet reviewed"
  // state, stored as NULL, never silently coerced to a specific vocabulary member.
  const addressClassification = field.addressClassification ?? null;
  const { rows } = await client.query(
    `INSERT INTO mls_fields
       (originating_system, reso_resource, field_name, reso_standard_name,
        data_type, scope, unit_of_measure, address_classification, is_address_bearing, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (originating_system, reso_resource, field_name)
       DO UPDATE SET reso_standard_name = EXCLUDED.reso_standard_name,
                     unit_of_measure    = EXCLUDED.unit_of_measure,
                     notes              = EXCLUDED.notes
     RETURNING id`,
    [
      field.originatingSystem,
      field.resoResource,
      field.fieldName,
      field.resoStandardName,
      field.dataType,
      field.scope,
      field.unitOfMeasure ?? null,
      addressClassification,
      // Derived, never passed separately, so it cannot disagree with the classification above
      // (mls_fields_classification_matches_bearing). Default-deny: NULL and every classification
      // except 'not_address_bearing' land on TRUE.
      addressClassification !== 'not_address_bearing',
      field.notes ?? null,
    ],
  );
  const id = rows[0]?.id;
  if (typeof id !== 'string') {
    throw new Error('Upsert on mls_fields returned no id.');
  }
  return id;
}

/**
 * Registers a permitted value for an enumerated field. THIS IS THE POINT OF THE WHOLE MODEL: adding a
 * value Bright invented last week is this INSERT, not a migration and not a redeploy.
 *
 * There is no matching `registerMlsConsumerDisplay()`, and the absence is deliberate —
 * `is_consumer_displayable` stays at its default-deny in this change because nothing is exposed to a
 * consumer yet. The sibling ticket that adds exposure adds the governed path for flipping it, so that
 * the review of "may a consumer see this field" happens in the ticket that can actually render it.
 */
export async function registerMlsLookupValue(
  client: Queryable,
  value: MlsLookupValueRegistration,
): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO mls_lookup_values (field_id, value, label, reso_standard_value, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (field_id, value)
       DO UPDATE SET label               = EXCLUDED.label,
                     reso_standard_value = EXCLUDED.reso_standard_value,
                     sort_order          = EXCLUDED.sort_order
     RETURNING id`,
    [
      value.fieldId,
      value.value,
      value.label,
      value.resoStandardValue ?? null,
      value.sortOrder ?? 0,
    ],
  );
  const id = rows[0]?.id;
  if (typeof id !== 'string') {
    throw new Error('Upsert on mls_lookup_values returned no id.');
  }
  return id;
}

interface RegisteredField {
  id: string;
  data_type: MlsDataType;
  scope: MlsFieldScope;
  retired_at: string | null;
}

async function lookupField(
  client: Queryable,
  key: MlsFieldKey,
): Promise<RegisteredField | undefined> {
  const { rows } = await client.query(
    `SELECT id, data_type, scope, retired_at
       FROM mls_fields
      WHERE originating_system = $1 AND reso_resource = $2 AND field_name = $3`,
    [key.originatingSystem, key.resoResource, key.fieldName],
  );
  return rows[0] as RegisteredField | undefined;
}

/** The five typed columns, in the order the INSERT below binds them. */
interface TypedValue {
  value_numeric: number | null;
  value_boolean: boolean | null;
  value_date: string | null;
  value_timestamp: string | null;
  value_lookup_id: string | null;
}

const EMPTY_TYPED_VALUE: TypedValue = {
  value_numeric: null,
  value_boolean: null,
  value_date: null,
  value_timestamp: null,
  value_lookup_id: null,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A decimal literal, and nothing else.
 *
 * `Number()` alone is too permissive for a value that is about to be bound to a `numeric` column: it
 * reads `'0x10'` as 16, `'Infinity'` as Infinity, and `''` as 0. A feed sending any of those has a
 * mapping problem, and guessing at it here is how a wrong number ends up looking like a real one.
 */
const DECIMAL_LITERAL = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * The column is `numeric(20,6)`, which leaves 20 − 6 = 14 digits before the point.
 *
 * Exceeding it raises `numeric field overflow` AT THE COLUMN — which would abort the caller's whole
 * ingest transaction, the precise failure this module exists to prevent. So the bound is enforced
 * here, where it can still be reported as an ordinary rejection. An `Edm.Int64`-shaped feed value
 * (a large numeric key) is the realistic way to hit it.
 */
const MAX_NUMERIC_MAGNITUDE = 1e14;

/**
 * Coerces one raw feed value against the field's registered type, or returns undefined to reject it.
 *
 * EVERY ARM MUST REJECT ANYTHING THE COLUMN WOULD THROW ON. A value that passes here and then raises
 * at the column takes down the surrounding transaction, so "the database will catch it" is not an
 * acceptable division of labour on this path — it is the batch-abort this module promises not to do.
 *
 * Numeric strings are accepted because RESO serialises `Edm.Decimal` as a string over JSON. Booleans
 * are NOT coerced from `'Y'`/`'1'` — a feed that spells them that way needs a reviewed mapping, not a
 * guess made at write time.
 */
function coerceScalar(dataType: MlsDataType, raw: unknown): TypedValue | undefined {
  switch (dataType) {
    case 'integer':
    case 'decimal': {
      const numeric =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string' && DECIMAL_LITERAL.test(raw.trim())
            ? Number(raw.trim())
            : NaN;
      if (!Number.isFinite(numeric) || Math.abs(numeric) >= MAX_NUMERIC_MAGNITUDE) {
        return undefined;
      }
      if (dataType === 'integer' && !Number.isInteger(numeric)) {
        return undefined;
      }
      // Scale is deliberately NOT rejected: the column rounds anything past 6 decimal places, and
      // dropping a lot size because the feed sent 0.3333333333 would lose a real value over a
      // difference that cannot matter. Magnitude is different — that one is an error, not a rounding.
      return { ...EMPTY_TYPED_VALUE, value_numeric: numeric };
    }
    case 'boolean':
      return typeof raw === 'boolean' ? { ...EMPTY_TYPED_VALUE, value_boolean: raw } : undefined;
    case 'date': {
      if (typeof raw !== 'string' || !ISO_DATE.test(raw)) {
        return undefined;
      }
      // The regex checks SHAPE, not calendar validity: `2026-02-30` and `2026-13-01` both match it and
      // then raise `date/time field value out of range` at the column. Round-tripping through Date is
      // what separates the two — JS rolls an impossible day over into the next month, so a date that
      // does not come back identical was never a real date.
      const parsed = new Date(`${raw}T00:00:00Z`);
      return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw
        ? undefined
        : { ...EMPTY_TYPED_VALUE, value_date: raw };
    }
    case 'timestamp': {
      if (!(typeof raw === 'string' || raw instanceof Date)) {
        return undefined;
      }
      const instant = raw instanceof Date ? raw : new Date(raw);
      return Number.isNaN(instant.getTime())
        ? undefined
        : { ...EMPTY_TYPED_VALUE, value_timestamp: instant.toISOString() };
    }
    default:
      // 'lookup' never reaches here — it resolves through the value registry, not a coercion.
      return undefined;
  }
}

/**
 * Resolves EVERY value of one enumerated field in a single round trip.
 *
 * One query per value would be ~200 extra round trips on a listing whose payload is mostly
 * vocabularies, on the workload this project's guide singles out as throughput-bound. The registry is
 * small and static within a run, so the whole set is fetched at once and matched in memory.
 */
async function resolveLookupValues(
  client: Queryable,
  fieldId: string,
  values: string[],
): Promise<Map<string, { id: string; retired: boolean }>> {
  if (values.length === 0) {
    return new Map();
  }
  const { rows } = await client.query(
    'SELECT id, value, retired_at FROM mls_lookup_values WHERE field_id = $1 AND value = ANY($2::text[])',
    [fieldId, [...new Set(values)]],
  );
  return new Map(
    rows.map((row) => [
      String(row.value),
      { id: String(row.id), retired: row.retired_at !== null && row.retired_at !== undefined },
    ]),
  );
}

interface AttributeTarget {
  table: 'listing_attributes' | 'property_attributes';
  ownerColumn: 'listing_id' | 'property_id';
  scope: MlsFieldScope;
}

const LISTING_TARGET: AttributeTarget = {
  table: 'listing_attributes',
  ownerColumn: 'listing_id',
  scope: 'listing',
};

const PROPERTY_TARGET: AttributeTarget = {
  table: 'property_attributes',
  ownerColumn: 'property_id',
  scope: 'property',
};

/**
 * Writes the offer-scoped attributes of one listing, replacing the stored set per field.
 *
 * `ownerId` is trusted to exist: the owner foreign key rejects an unknown id, and this module is
 * called from inside the ingest transaction that created the row.
 */
export function putListingAttributes(
  client: Queryable,
  listingId: string,
  attributes: MlsAttributeInput[],
): Promise<MlsAttributeWriteResult> {
  return putAttributes(client, LISTING_TARGET, listingId, attributes);
}

/**
 * Writes the durable, offer-independent attributes of one property.
 *
 * The split is the same one `properties` vs `listings` already makes: a construction material is true
 * of the building across every offer it ever carries, while a seller concession belongs to one offer.
 * Which table a field may land in is not this caller's choice — it is declared on the field and
 * enforced by a composite foreign key, so passing a listing-scoped field here is rejected.
 */
export function putPropertyAttributes(
  client: Queryable,
  propertyId: string,
  attributes: MlsAttributeInput[],
): Promise<MlsAttributeWriteResult> {
  return putAttributes(client, PROPERTY_TARGET, propertyId, attributes);
}

/** One incoming value that resolved all the way to something storable. */
interface ResolvedValue {
  typed: TypedValue;
  valueKind: MlsDataType;
  sourceModificationTimestamp: string | null;
}

function fieldKeyOf(input: MlsFieldKey): string {
  return JSON.stringify([input.originatingSystem, input.resoResource, input.fieldName]);
}

async function putAttributes(
  client: Queryable,
  target: AttributeTarget,
  ownerId: string,
  attributes: MlsAttributeInput[],
): Promise<MlsAttributeWriteResult> {
  const rejected: MlsAttributeRejection[] = [];
  let stored = 0;
  let removed = 0;

  // Group by field first: replacement is per field, and a field is applied all-or-nothing.
  const byField = new Map<string, MlsAttributeInput[]>();
  for (const attribute of attributes) {
    const key = fieldKeyOf(attribute);
    const group = byField.get(key);
    if (group) {
      group.push(attribute);
    } else {
      byField.set(key, [attribute]);
    }
  }

  for (const group of byField.values()) {
    const first = group[0];
    if (!first) {
      continue;
    }
    const key: MlsFieldKey = first;
    const reject = (reason: MlsRejectionReason, value: unknown): void => {
      rejected.push({
        originatingSystem: key.originatingSystem,
        resoResource: key.resoResource,
        fieldName: key.fieldName,
        reason,
        value: describeValue(value),
      });
    };

    const field = await lookupField(client, key);
    if (!field) {
      reject('unregistered_field', first.value);
      continue;
    }
    if (field.retired_at) {
      reject('retired_field', first.value);
      continue;
    }
    // Declared scope decides the table. The composite FK would reject this too; catching it here keeps
    // a mapping mistake from aborting the batch, and names the field that caused it.
    if (field.scope !== target.scope) {
      reject('wrong_scope', first.value);
      continue;
    }

    // Flatten: an array is a multi-valued lookup, a scalar is one value, null/undefined clears.
    const raw: { value: unknown; timestamp: string | null }[] = [];
    let fieldRejected = false;
    for (const attribute of group) {
      const timestamp = attribute.sourceModificationTimestamp ?? null;
      if (attribute.value === null || attribute.value === undefined) {
        continue;
      }
      if (Array.isArray(attribute.value)) {
        // Only an ENUMERATED field is multi-valued. An array on a scalar field is a mapping mistake,
        // and it has to be rejected rather than flattened: each member would upsert onto the same row
        // (the unique index is NULLS NOT DISTINCT, deliberately), so the last one would silently win
        // while every member was reported as stored — a wrong value that looks like a right one.
        if (field.data_type !== 'lookup') {
          reject('type_mismatch', attribute.value);
          fieldRejected = true;
          break;
        }
        for (const member of attribute.value) {
          raw.push({ value: member, timestamp });
        }
      } else {
        raw.push({ value: attribute.value, timestamp });
      }
    }

    // Resolved in one round trip for the whole field, rather than one per value.
    const lookupMatches =
      field.data_type === 'lookup' && !fieldRejected
        ? await resolveLookupValues(
            client,
            field.id,
            raw
              .map((entry) => entry.value)
              .filter((value): value is string => typeof value === 'string'),
          )
        : new Map<string, { id: string; retired: boolean }>();

    const resolved: ResolvedValue[] = [];
    for (const entry of fieldRejected ? [] : raw) {
      if (field.data_type === 'lookup') {
        if (typeof entry.value !== 'string') {
          reject('type_mismatch', entry.value);
          fieldRejected = true;
          continue;
        }
        const match = lookupMatches.get(entry.value);
        if (!match) {
          reject('unregistered_value', entry.value);
          fieldRejected = true;
          continue;
        }
        if (match.retired) {
          reject('retired_value', entry.value);
          fieldRejected = true;
          continue;
        }
        resolved.push({
          typed: { ...EMPTY_TYPED_VALUE, value_lookup_id: match.id },
          valueKind: 'lookup',
          sourceModificationTimestamp: entry.timestamp,
        });
        continue;
      }

      const typed = coerceScalar(field.data_type, entry.value);
      if (!typed) {
        reject('type_mismatch', entry.value);
        // Deliberately NOT a `break`: every bad value of this field is reported in one pass, so
        // closing a vocabulary gap takes one ingest run rather than one run per missing token. The
        // field is still applied all-or-nothing — `fieldRejected` is what enforces that.
        fieldRejected = true;
        continue;
      }
      resolved.push({
        typed,
        valueKind: field.data_type,
        sourceModificationTimestamp: entry.timestamp,
      });
    }

    // All-or-nothing: leave the stored set untouched rather than half-applying it. See the header.
    if (fieldRejected) {
      continue;
    }

    for (const value of resolved) {
      await client.query(
        `INSERT INTO ${target.table}
           (${target.ownerColumn}, field_id, field_scope, value_kind,
            value_numeric, value_boolean, value_date, value_timestamp, value_lookup_id,
            source_modification_timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (${target.ownerColumn}, field_id, value_lookup_id)
           DO UPDATE SET value_kind                    = EXCLUDED.value_kind,
                         value_numeric                 = EXCLUDED.value_numeric,
                         value_boolean                 = EXCLUDED.value_boolean,
                         value_date                    = EXCLUDED.value_date,
                         value_timestamp               = EXCLUDED.value_timestamp,
                         source_modification_timestamp = EXCLUDED.source_modification_timestamp`,
        [
          ownerId,
          field.id,
          target.scope,
          value.valueKind,
          value.typed.value_numeric,
          value.typed.value_boolean,
          value.typed.value_date,
          value.typed.value_timestamp,
          value.typed.value_lookup_id,
          value.sourceModificationTimestamp,
        ],
      );
      stored += 1;
    }

    // The half an upsert cannot express: a value the feed has STOPPED sending has to disappear. Scoped
    // to this one field, so a partial payload never touches a field it did not mention.
    //
    // The CASE is what makes one statement serve both shapes. A lookup row survives only if its value
    // is in the set just written; the single scalar row (value_lookup_id IS NULL) survives only if a
    // scalar was written at all. When the feed sent nothing for the field, both arms delete — which is
    // the case that actually matters, since it is the only way a withdrawn value ever leaves.
    const keptLookupIds = resolved
      .map((value) => value.typed.value_lookup_id)
      .filter((id): id is string => id !== null);
    const keptScalar = resolved.some((value) => value.typed.value_lookup_id === null);
    const { rows: deleted } = await client.query(
      `DELETE FROM ${target.table}
        WHERE ${target.ownerColumn} = $1
          AND field_id = $2
          AND CASE WHEN value_lookup_id IS NULL
                   THEN NOT $4
                   ELSE NOT (value_lookup_id = ANY($3::uuid[]))
              END
        RETURNING id`,
      [ownerId, field.id, keptLookupIds, keptScalar],
    );
    removed += deleted.length;
  }

  return { stored, removed, rejected };
}
