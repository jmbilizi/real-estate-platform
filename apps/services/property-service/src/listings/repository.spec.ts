import { getListingAttributes, getPropertyAttributes, type ReadClient } from './repository';

/**
 * `getListingAttributes()`/`getPropertyAttributes()` (#128) are the repository-level mechanism the
 * ticket's acceptance criteria mean by "search and detail responses": the query that will back both
 * `searchListings()` and `findListingById()` once #93 exposes attributes on the wire, proven here
 * against a fake `ReadClient` — no database, matching every other test in this file's siblings.
 *
 * The suppression signal passed in is the listing's ADDRESS itself (`null` on a suppressed
 * listing), never a pre-computed boolean — the same shape `applyAddressSuppression()` and
 * `applyCardAddressSuppression()` read off their own object, so a caller cannot pass a suppression
 * outcome that belongs to a different listing.
 */
const SUPPRESSED_ADDRESS = null;
const PUBLISHED_ADDRESS = '900 King St';

interface AttributeFixture {
  id?: string;
  field_id?: string;
  value_kind?: string;
  value_numeric?: string | null;
  value_boolean?: boolean | null;
  value_date?: string | null;
  value_timestamp?: string | null;
  value_lookup_id?: string | null;
  originating_system?: string;
  reso_resource?: string;
  field_name?: string;
  address_classification?: string | null;
  is_consumer_displayable?: boolean;
}

function row(overrides: AttributeFixture = {}): Required<AttributeFixture> {
  return {
    id: 'attr-1',
    field_id: 'field-1',
    value_kind: 'decimal',
    value_numeric: '0.34',
    value_boolean: null,
    value_date: null,
    value_timestamp: null,
    value_lookup_id: null,
    originating_system: 'testMLS',
    reso_resource: 'Property',
    field_name: 'LotSizeAcres',
    address_classification: null,
    is_consumer_displayable: false,
    ...overrides,
  };
}

function fakeClient(rows: AttributeFixture[]): ReadClient {
  return {
    query: <T>() => Promise.resolve({ rows: rows as unknown as T[] }),
  };
}

describe('getListingAttributes', () => {
  it('withholds an unclassified attribute when the listing is address-suppressed — default-deny', async () => {
    const client = fakeClient([row({ address_classification: null })]);

    const attributes = await getListingAttributes(client, 'listing-1', SUPPRESSED_ADDRESS);

    expect(attributes).toEqual([]);
  });

  it('publishes an unclassified attribute when the listing is not suppressed', async () => {
    const client = fakeClient([row({ address_classification: null })]);

    const attributes = await getListingAttributes(client, 'listing-1', PUBLISHED_ADDRESS);

    expect(attributes).toHaveLength(1);
  });

  it('publishes an attribute explicitly classified not_address_bearing even when suppressed', async () => {
    const client = fakeClient([row({ address_classification: 'not_address_bearing' })]);

    const attributes = await getListingAttributes(client, 'listing-1', SUPPRESSED_ADDRESS);

    expect(attributes).toHaveLength(1);
  });

  it.each(['carries_address', 're_identifies_address', 'free_text_may_contain_address'])(
    'withholds an attribute classified %s when the listing is suppressed',
    async (addressClassification) => {
      const client = fakeClient([row({ address_classification: addressClassification })]);

      const attributes = await getListingAttributes(client, 'listing-1', SUPPRESSED_ADDRESS);

      expect(attributes).toEqual([]);
    },
  );

  it('reads listing_attributes joined to mls_fields, scoped to the requested listing', async () => {
    let capturedText = '';
    let capturedValues: unknown[] = [];
    const client: ReadClient = {
      query: (text, values) => {
        capturedText = text;
        capturedValues = values ?? [];
        return Promise.resolve({ rows: [] });
      },
    };

    await getListingAttributes(client, 'listing-1', PUBLISHED_ADDRESS);

    expect(capturedText).toContain('FROM listing_attributes a');
    expect(capturedText).toContain('JOIN mls_fields f ON f.id = a.field_id');
    expect(capturedText).toContain('WHERE a.listing_id = $1');
    expect(capturedValues).toEqual(['listing-1']);
  });
});

describe('getPropertyAttributes', () => {
  it('withholds an unclassified attribute when the owning listing is address-suppressed', async () => {
    const client = fakeClient([row({ address_classification: null })]);

    const attributes = await getPropertyAttributes(client, 'property-1', SUPPRESSED_ADDRESS);

    expect(attributes).toEqual([]);
  });

  it('reads property_attributes joined to mls_fields, scoped to the requested property', async () => {
    let capturedText = '';
    let capturedValues: unknown[] = [];
    const client: ReadClient = {
      query: (text, values) => {
        capturedText = text;
        capturedValues = values ?? [];
        return Promise.resolve({ rows: [] });
      },
    };

    await getPropertyAttributes(client, 'property-1', PUBLISHED_ADDRESS);

    expect(capturedText).toContain('FROM property_attributes a');
    expect(capturedText).toContain('WHERE a.property_id = $1');
    expect(capturedValues).toEqual(['property-1']);
  });
});
