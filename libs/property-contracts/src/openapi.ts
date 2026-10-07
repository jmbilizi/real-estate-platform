import { z } from 'zod';
import { idSchema } from './common';
import { listingCardSchema, listingsEnvelopeSchema } from './listing-card';
import { listingDetailSchema } from './listing-detail';
import { propertyLookupResponseSchema, propertyPageSchema } from './property-page';
import { listingInquiryRequestSchema, listingInquiryResponseSchema } from './listing-inquiry';
import { listingsMetaSchema } from './listings-meta';
import { savedHomesEnvelopeSchema, savedHomesRequestSchema, savedStateSchema } from './saved-homes';
import { neighborhoodsRequestSchema, neighborhoodsResponseSchema } from './neighborhoods';
import { mapRequestSchema, mapResponseSchema } from './listing-map';
import { errorBodySchema } from './errors';
import {
  agentProfileSchema,
  createAgentProfileRequestSchema,
  staffAgentsEnvelopeSchema,
  staffAgentsRequestSchema,
  staffLeadAssignRequestSchema,
  staffLeadAssignResponseSchema,
  staffLeadDetailSchema,
  staffLeadNoteRequestSchema,
  staffLeadNoteSchema,
  staffLeadsEnvelopeSchema,
  staffLeadsRequestSchema,
  staffLeadTransitionRequestSchema,
  staffLeadTransitionResponseSchema,
  staffLeadUnassignRequestSchema,
  staffMeSchema,
  updateAgentProfileRequestSchema,
} from './staff';
import {
  MAX_RESULT_OFFSET,
  maxReachablePage,
  PAGE_SIZE_DEFAULT,
  searchRequestSchema,
} from './search-request';

/**
 * `unrepresentable` is deliberately left at its default (`'throw'`), not `'any'`. `'any'` would
 * make the next schema change that adds a transform on an output path render as a silent `{}` in
 * this frozen contract instead of failing the test run — exactly the trap this package's own
 * AGENTS.md warns about. If a future schema genuinely can't be represented, the fix is to reshape
 * the schema (as `queryInt`/`queryBathCount` already do for coerced query params), not to paper
 * over it here.
 */
const schema = (value: z.ZodType, io: 'input' | 'output' = 'output') =>
  z.toJSONSchema(value, { target: 'openapi-3.0', io });

/** Query parameters, derived from the request schema so the two cannot drift. */
function searchParameters(requestSchema: z.ZodType = searchRequestSchema) {
  const requestJsonSchema = schema(requestSchema, 'input') as {
    properties: Record<string, unknown>;
    required?: string[];
  };
  return Object.entries(requestJsonSchema.properties).map(([name, propertySchema]) => {
    const parameter: Record<string, unknown> = {
      name,
      in: 'query',
      required: requestJsonSchema.required?.includes(name) ?? false,
      schema: propertySchema,
    };
    if (name === 'amenities') {
      // `style`/`explode` are the only OpenAPI-level vocabulary for how an array-typed query
      // parameter serializes; `form`/`explode: false` documents the comma-list form
      // (`?amenities=Pool,Garage`) this schema's `anyOf` schema advertises but which is otherwise
      // invisible to a codegen tool. The repeated-parameter form this schema also accepts
      // (`?amenities=Pool&amenities=Garage`) has no keyword of its own here, so it stays called
      // out in the schema's own `description` instead (#47 review, M3).
      parameter['style'] = 'form';
      parameter['explode'] = false;
    }
    return parameter;
  });
}

/**
 * The five response/error schemas in one `z.toJSONSchema()` call over a registry, rather than
 * five independent calls. `listingCardSchema` is the exact same schema instance embedded inside
 * `listingsEnvelopeSchema` (`results: z.array(listingCardSchema)`), and only a single shared call
 * lets Zod's identity-based dedup notice that and emit a `$ref` instead of inlining the ~40-field
 * card a second time. (`ListingDetail.listing` does NOT dedup this way — it's a genuinely
 * different schema, built via `listingCardSchema.omit(...).extend(...)`, so it is a distinct
 * object with no shared identity to detect; it stays inline.)
 *
 * The registry's `uri` callback is what makes `$ref` point at `#/components/schemas/<id>` instead
 * of a bare id, but as a side effect Zod also stamps a `$id` keyword onto every registered
 * top-level schema so its own resolver can find them again — `$id` is not a valid OpenAPI 3.0
 * Schema Object keyword, so it's stripped from each schema before publishing.
 */
function componentSchemas() {
  const registry = z.registry<{ id: string }>();
  registry.add(listingCardSchema, { id: 'ListingCardRow' });
  registry.add(listingsEnvelopeSchema, { id: 'ListingsEnvelope' });
  registry.add(listingDetailSchema, { id: 'ListingDetail' });
  registry.add(propertyPageSchema, { id: 'PropertyPage' });
  registry.add(propertyLookupResponseSchema, { id: 'PropertyLookupResponse' });
  registry.add(listingsMetaSchema, { id: 'ListingsMeta' });
  registry.add(neighborhoodsResponseSchema, { id: 'NeighborhoodsResponse' });
  registry.add(mapResponseSchema, { id: 'MapResponse' });
  registry.add(listingInquiryRequestSchema, { id: 'ListingInquiryRequest' });
  registry.add(listingInquiryResponseSchema, { id: 'ListingInquiryResponse' });
  registry.add(savedHomesEnvelopeSchema, { id: 'SavedHomesEnvelope' });
  registry.add(savedStateSchema, { id: 'SavedState' });
  registry.add(staffMeSchema, { id: 'StaffMe' });
  registry.add(staffLeadsEnvelopeSchema, { id: 'StaffLeadsEnvelope' });
  registry.add(staffLeadDetailSchema, { id: 'StaffLeadDetail' });
  registry.add(staffLeadTransitionRequestSchema, { id: 'StaffLeadTransitionRequest' });
  registry.add(staffLeadTransitionResponseSchema, { id: 'StaffLeadTransitionResponse' });
  registry.add(staffLeadNoteRequestSchema, { id: 'StaffLeadNoteRequest' });
  registry.add(staffLeadNoteSchema, { id: 'StaffLeadNote' });
  registry.add(agentProfileSchema, { id: 'AgentProfile' });
  registry.add(staffAgentsEnvelopeSchema, { id: 'StaffAgentsEnvelope' });
  registry.add(createAgentProfileRequestSchema, { id: 'CreateAgentProfileRequest' });
  registry.add(updateAgentProfileRequestSchema, { id: 'UpdateAgentProfileRequest' });
  registry.add(staffLeadAssignRequestSchema, { id: 'StaffLeadAssignRequest' });
  registry.add(staffLeadAssignResponseSchema, { id: 'StaffLeadAssignResponse' });
  registry.add(staffLeadUnassignRequestSchema, { id: 'StaffLeadUnassignRequest' });
  registry.add(errorBodySchema, { id: 'ErrorBody' });

  const { schemas } = z.toJSONSchema(registry, {
    target: 'openapi-3.0',
    uri: (id) => `#/components/schemas/${id}`,
  });

  for (const componentSchema of Object.values(schemas)) {
    delete (componentSchema as { $id?: unknown }).$id;
  }

  return schemas;
}

/**
 * Documented on every operation, because every operation can emit it: the service's error boundary
 * turns any unhandled rejection into a 500 carrying `INTERNAL_ERROR_BODY`. Leaving it undocumented
 * meant a client generated from this document had no branch that could deserialise a response the
 * service really sends — the same drift class this package exists to prevent, just in the direction
 * nobody checks.
 *
 * 429 is deliberately NOT documented here: rate limiting is enforced by the gateway's Ocelot route
 * configuration, not by this service, so it is not this document's claim to make. The gateway's own
 * 429/502/503 contract lives in `@cribstop/gateway-contracts` instead (#177).
 */
const serverErrorResponse = {
  description: 'Unexpected server error. The body carries no detail by design.',
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
  },
};

const unavailableResponse = {
  description:
    'account-service did not answer, so the session is unknown. Retry. This is not a sign-out.',
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
  },
};

const unauthenticatedResponse = {
  description: 'No valid credential. The body gives no reason.',
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
  },
};

const forbiddenResponse = {
  description: 'A valid credential with none of the allowed roles (`forbidden`).',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
};

const staffBadRequestResponse = {
  description: 'Invalid or unknown parameter or body field (`invalid_request`).',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
};

const staffNotFoundResponse = {
  description: 'No lead has this id (`not_found`).',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
};

const staffAgentNotFoundResponse = {
  description: 'No agent profile has this id (`not_found`).',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
};

const staffConflictResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
});

const staffAgentIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: schema(idSchema, 'input'),
};

const staffLeadIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: schema(idSchema, 'input'),
};

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
      // `<Domain> Service`, matching every other entry the gateway aggregates (`Account Service`,
      // `Inference Service`). Deliberately NOT named for a client: `cribstop-next` is one consumer
      // of this document, not its owner, and a document named for one client is wrong the moment a
      // second one (an agent tool, a partner feed) reads it. Deliberately not "Listings API"
      // either: property-service owns the whole Communities → Properties → Units → Listings
      // hierarchy, so `listings` is one resource within this API rather than the name of it. The
      // paths below stay `/listings/*` and mirror the gateway's DownstreamPathTemplate values — a
      // service name is not a resource name, and the `/property/*` namespace is applied by the
      // gateway's upstream templates, not restated here.
      title: 'Property Service',
      version: '1.0.0',
      description:
        "`property-service`'s HTTP API. The service owns the Communities → Properties → Units → " +
        'Listings hierarchy; `listings` is the resource this version of the document exposes, and ' +
        'a later resource extends THIS document rather than publishing a second one — the ' +
        'aggregation key is part of the docs URL, so splitting would break every bookmark. Every ' +
        'response carries the full ' +
        'broker/office attribution block (NAR 7.58, PRD §6.2), there is no field-selection ' +
        'parameter, and unknown query parameters are rejected with 400 — so no caller can omit ' +
        'it. Results are read through a compliance-enforcing view that applies two distinct ' +
        'seller opt-outs. A listing withheld from internet display is absent entirely: omitted ' +
        'from search results and from `total`, and indistinguishable from an unknown id on detail ' +
        '(the same 404, byte for byte). A listing whose street address is withheld is still ' +
        'returned, with `address`, `latitude` and `longitude` null together and `unit.unitNumber` ' +
        'withheld on detail, so the address cannot be reconstructed; such rows remain in `total` ' +
        'and simply have no map coordinates — never substitute a city or ZIP centroid for them. ' +
        'Free-text `query` matches title, address, ' +
        'city, neighborhood and zip — never the description, which is third-party MLS remarks ' +
        'carrying a moderation state; making it searchable would allow keyword-based steering on ' +
        'protected-class language (PRD §6.3). A seller may also suppress price, photos, days on ' +
        'market or price history individually (#53) while the listing stays syndicated; a field ' +
        'withheld this way is null (or, for photos, reduced to at most one image), and the ' +
        'listing remains in results and in `total`. See the `minPrice`/`maxPrice`/`sort` ' +
        'parameter descriptions for how a seller-suppressed price interacts with range filters ' +
        'and ordering.',
    },
    paths: {
      '/listings': {
        get: {
          operationId: 'searchListings',
          summary: 'Search listings',
          description:
            'Sorted with a deterministic total order, so paging is stable. `listingType=all` ' +
            'covers currently marketed listings and excludes sold; ask for `sold` explicitly.\n\n' +
            'This is a SEARCH surface, not a bulk-export surface. Paging depth is bounded: ' +
            `\`(page - 1) * pageSize\` must not exceed ${MAX_RESULT_OFFSET}, so at the default ` +
            `page size of ${PAGE_SIZE_DEFAULT} the deepest reachable page is ` +
            `${maxReachablePage(PAGE_SIZE_DEFAULT)}. A request past that window is rejected with ` +
            '400 and the error code `result_window_exceeded` — it is never silently clamped to ' +
            'the last valid page, and never answered with an empty 200. There is no parameter ' +
            'that lifts the bound. To reach listings outside the window, narrow the search with ' +
            'filters; retrieving the whole set is not a supported operation.\n\n' +
            'The bound is on depth alone — no filter is required, and an unfiltered search is a ' +
            'supported browse path. It is also independent of the past-the-end rule: a page ' +
            'beyond the last result but INSIDE the window is a normal 200 with an empty ' +
            '`results` array. `total` is always the exact count of the full filtered set, even ' +
            'when that count exceeds the window — it is never clamped to it.\n\n' +
            'The optional `bounds` limits the result to a viewport. It is ANDed with every other ' +
            'filter, so the result is the searched place within the viewport. A listing whose ' +
            'street address is withheld has no coordinates, so it is not in a viewport result.\n\n' +
            'A signed-in request also gets `isSaved` and `isFavorited` on each result, resolved ' +
            'by home, and a `private, no-store` response. A signed-out request never gets them ' +
            'and is never rejected for lacking a credential.',
          parameters: searchParameters(),
          responses: {
            '200': {
              description: 'A page of listings with an exact total.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ListingsEnvelope' } },
              },
            },
            '400': {
              description:
                'Unknown or invalid query parameter (`invalid_request`), or a page past the ' +
                'reachable result window (`result_window_exceeded`). The two carry different ' +
                'error codes because they call for different responses: the first means a ' +
                'parameter needs fixing, the second that the search needs narrowing — retrying ' +
                'the same request will never succeed.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '500': serverErrorResponse,
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
            '500': serverErrorResponse,
          },
        },
      },
      '/listings/neighborhoods': {
        get: {
          operationId: 'getNeighborhoods',
          summary: 'Neighborhood groups',
          description:
            'Publishable listings grouped by neighborhood. The request takes the `GET /listings` ' +
            'filters. The groups are the neighborhoods of the listings that search returns. A row ' +
            'has counts, photos, a centroid and bounds. It has no ranking and no descriptive ' +
            'word. `key` is the identity. The centroid and bounds use only listings with address ' +
            'display allowed. `minCount` defaults to 3. Send `minCount=1` for every group. Page ' +
            'with `limit` and `offset`. `name` is title case, built from the most frequent raw ' +
            'feed variant in the group. `slug` matches the property page’s slug rules. `total` ' +
            'in the response is the exact count of matching neighborhoods, never clamped to ' +
            '`limit`.',
          parameters: searchParameters(neighborhoodsRequestSchema),
          responses: {
            '200': {
              description: 'Neighborhoods with a listing count at or above minCount.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/NeighborhoodsResponse' },
                },
              },
            },
            '400': {
              description: 'Unknown or invalid query parameter (`invalid_request`).',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '500': serverErrorResponse,
          },
        },
      },
      '/listings/map': {
        get: {
          operationId: 'getListingsMap',
          summary: 'Map pins for a viewport',
          description:
            'Takes the same filters as `/listings`, without paging or sort, plus the viewport ' +
            '`bounds`. The matching set is the search set limited to the viewport. The response ' +
            'is one pin per listing, newest first, up to a cap. `total` counts every match in ' +
            'the viewport, so `total` above the pin count means the cap applied. The response ' +
            'never holds clusters. A listing whose street address is withheld has no ' +
            'coordinates, so it is in no pin and not in `total`.',
          parameters: searchParameters(mapRequestSchema),
          responses: {
            '200': {
              description: 'Pins and the viewport total.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/MapResponse' } },
              },
            },
            '400': {
              description: 'Unknown or invalid query parameter (`invalid_request`).',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '500': serverErrorResponse,
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
            { name: 'id', in: 'path', required: true, schema: schema(idSchema, 'input') },
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
            '500': serverErrorResponse,
          },
        },
      },
      '/listings/{id}/card': {
        get: {
          operationId: 'getListingCard',
          summary: 'Listing card',
          description:
            'Returns the one card row that search returns for this listing, with the same ' +
            'address suppression. A map pin for a listing outside the current results page ' +
            'renders its popup card from this. Unknown, removed and seller-suppressed listings ' +
            'are indistinguishable.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: schema(idSchema, 'input') },
          ],
          responses: {
            '200': {
              description: 'The listing card.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ListingCardRow' } },
              },
            },
            '404': {
              description: 'No such listing.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '500': serverErrorResponse,
          },
        },
      },
      '/listings/{id}/page': {
        get: {
          operationId: 'getListingPropertyPage',
          summary: 'Property page of the home that one listing is on',
          description:
            'Returns the same page as /properties/{id}/page for the home of this listing. ' +
            'A client uses canonicalPath to redirect an old /listing/<id> URL.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: schema(idSchema, 'input') },
          ],
          responses: {
            '200': {
              description: 'The property page.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/PropertyPage' } },
              },
            },
            '404': {
              description: 'No such listing.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '500': serverErrorResponse,
          },
        },
      },
      '/properties/{id}/page': {
        get: {
          operationId: 'getPropertyPage',
          summary: 'Everything the property page renders, in any market status',
          description:
            'The id is the unit id in a subdivided building, else the property id. The response ' +
            'carries the canonical path and slug, the status label, the display flags, the ' +
            'latest listing, the compliance-filtered history, nearby active listings and SEO ' +
            'text. An Off market home returns the property record only, with latestListing null.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: schema(idSchema, 'input') },
          ],
          responses: {
            '200': {
              description: 'The property page.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/PropertyPage' } },
              },
            },
            '404': {
              description: 'No such home.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '500': serverErrorResponse,
          },
        },
      },
      '/properties/lookup': {
        get: {
          operationId: 'lookupProperty',
          summary: 'Resolve a property path to listings',
          description:
            'Takes the two segments of /<city>-<st>/<address-slug>. On a local miss the ' +
            'service reads that one address from the MLS across all statuses, then resolves again.',
          parameters: [
            { name: 'city', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'address', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'One or more matches. More than one means the path is ambiguous.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PropertyLookupResponse' },
                },
              },
            },
            '400': {
              description: 'The segments do not form a property path.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '404': {
              description: 'No property at that address.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '500': serverErrorResponse,
          },
        },
      },
      '/listings/{id}/inquiries': {
        post: {
          operationId: 'createListingInquiry',
          summary: 'Submit a message or tour request against a listing',
          description:
            'Works signed-out and signed-in. An unauthenticated request is never rejected for ' +
            'being unauthenticated. `name` and `email` are always required. ' +
            '`consentTextVersion` is required for new clients. With `consentToContact` true and ' +
            'no version, the server records `v1`. `phone` is optional. A signed-in account with a confirmed email always uses the ' +
            'account email. The server ignores the `email` in the body for it. ' +
            '`consentToContact` records that the consumer agreed to be contacted. ' +
            'The server stores the consent text for `consentTextVersion`, the `consentChannels` ' +
            'and the time. The record starts in the `new` lead status. No public read endpoint ' +
            'returns it.\n\n' +
            'Rate-limited per client and per listing; a request over either limit gets 429 with ' +
            'a `Retry-After` header.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: schema(idSchema, 'input') },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ListingInquiryRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'The inquiry was recorded.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ListingInquiryResponse' },
                },
              },
            },
            '400': {
              description:
                'Unknown field, missing `name`/`email`, or `message` missing/empty when `kind` ' +
                'is `message`.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '404': {
              description: 'No such listing, or not publishable through `listing_search_v`.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '429': {
              description:
                'Rate limit exceeded for this client or this listing. Documented here — unlike ' +
                'the read endpoints above — because this limit is enforced by the service ' +
                'itself (keyed on the path parameter), not by the gateway.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '500': serverErrorResponse,
          },
        },
      },
      '/listings/{id}/saved': {
        put: {
          operationId: 'saveListingHome',
          summary: 'Save the home that one listing is on',
          description:
            'Requires sign-in. The service resolves the home of the listing, so the client does ' +
            'not need a property id. Saving is idempotent: saving a home again, through the same ' +
            'or another listing, is the same save. A save belongs to the account, never to a role.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: schema(idSchema, 'input') },
          ],
          responses: {
            '200': {
              description: 'The home is saved.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SavedState' } },
              },
            },
            '401': unauthenticatedResponse,
            '503': unavailableResponse,
            '404': {
              description: 'No such listing.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '500': serverErrorResponse,
          },
        },
        delete: {
          operationId: 'unsaveListingHome',
          summary: 'Remove the home that one listing is on from saved homes',
          description:
            'Requires sign-in. Removing a home that is not saved is a success with `saved` false.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: schema(idSchema, 'input') },
          ],
          responses: {
            '200': {
              description: 'The home is not saved.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SavedState' } },
              },
            },
            '401': unauthenticatedResponse,
            '503': unavailableResponse,
            '404': {
              description: 'No such listing.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '500': serverErrorResponse,
          },
        },
      },
      '/saved-homes': {
        get: {
          operationId: 'listSavedHomes',
          summary: 'The saved homes of the signed-in account',
          description:
            'Requires sign-in. Returns only the calling account’s homes, newest save first. ' +
            'Each row is a home: the property facts plus its current consumer-visible listing, ' +
            'or `listing` null when it has none. An off-market home is a normal row, never a ' +
            '404 and never left out. Address and coordinates carry the same masking as search. ' +
            'The response is `private, no-store`.',
          parameters: searchParameters(savedHomesRequestSchema),
          responses: {
            '200': {
              description: 'A page of saved homes with an exact total.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SavedHomesEnvelope' } },
              },
            },
            '400': {
              description: 'Unknown or invalid query parameter (`invalid_request`).',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '401': unauthenticatedResponse,
            '503': unavailableResponse,
            '500': serverErrorResponse,
          },
        },
      },
      '/saved-homes/{id}': {
        delete: {
          operationId: 'unsaveHome',
          summary: 'Remove a saved home by its home id',
          description:
            'Requires sign-in. `id` is the `propertyId` of a saved home. It works for a home with ' +
            'no consumer-visible listing. Removing a home that is not saved is a success with ' +
            '`saved` false. A request never touches another account’s saves.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: schema(idSchema, 'input') },
          ],
          responses: {
            '200': {
              description: 'The home is not saved.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SavedState' } },
              },
            },
            '401': unauthenticatedResponse,
            '503': unavailableResponse,
            '404': {
              description: 'The id is not a well-formed id.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '500': serverErrorResponse,
          },
        },
      },
      '/staff/me': {
        get: {
          operationId: 'getStaffMe',
          summary: 'The roles of the signed-in account',
          description:
            'Requires sign-in, and no particular role. Returns the roles of the calling account ' +
            'as a list and nothing else. A buyer-only account gets `["User"]`. The response is ' +
            '`private, no-store`.',
          responses: {
            '200': {
              description: 'The roles of the calling account.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/StaffMe' } },
              },
            },
            '401': unauthenticatedResponse,
            '503': unavailableResponse,
            '500': serverErrorResponse,
          },
        },
      },
      '/staff/leads': {
        get: {
          operationId: 'listStaffLeads',
          summary: 'Buyer requests, for staff',
          description:
            'Requires the Admin, SuperAdmin or Moderator role. Newest first, cursor paging, page ' +
            'size capped at 50. Email and phone are masked. A row has `possibleDuplicate` when ' +
            'another open request on the same listing came within seven days from the same email ' +
            'or phone. The server never merges leads. The response is `private, no-store`.',
          parameters: searchParameters(staffLeadsRequestSchema),
          responses: {
            '200': {
              description: 'A page of leads.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/StaffLeadsEnvelope' } },
              },
            },
            '400': staffBadRequestResponse,
            '401': unauthenticatedResponse,
            '403': forbiddenResponse,
            '503': unavailableResponse,
            '500': serverErrorResponse,
          },
        },
      },
      '/staff/leads/{id}': {
        get: {
          operationId: 'getStaffLead',
          summary: 'One buyer request, with full contact details',
          description:
            'Requires the Admin, SuperAdmin or Moderator role. Every successful read writes an ' +
            'access-audit row. The response is `private, no-store`.',
          parameters: [staffLeadIdParameter],
          responses: {
            '200': {
              description: 'The lead.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/StaffLeadDetail' } },
              },
            },
            '401': unauthenticatedResponse,
            '403': forbiddenResponse,
            '404': staffNotFoundResponse,
            '503': unavailableResponse,
            '500': serverErrorResponse,
          },
        },
      },
      '/staff/leads/{id}/transition': {
        post: {
          operationId: 'transitionStaffLead',
          summary: 'Move a lead to a new status',
          description:
            'Requires the Admin, SuperAdmin or Moderator role. A Moderator may set `verified`, ' +
            '`spam` and `rejected`. Admin and SuperAdmin may also set `new` to restore a spam ' +
            'lead. A note is required for `spam` and `rejected`. A change the transitions table ' +
            'does not allow returns 409.',
          parameters: [staffLeadIdParameter],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StaffLeadTransitionRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'The lead moved.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StaffLeadTransitionResponse' },
                },
              },
            },
            '400': staffBadRequestResponse,
            '401': unauthenticatedResponse,
            '403': forbiddenResponse,
            '404': staffNotFoundResponse,
            '409': {
              description: 'The transitions table does not allow this change (`conflict`).',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '503': unavailableResponse,
            '500': serverErrorResponse,
          },
        },
      },
      '/staff/leads/{id}/notes': {
        post: {
          operationId: 'addStaffLeadNote',
          summary: 'Add an internal note to a lead',
          description:
            'Requires the Admin, SuperAdmin or Moderator role. Notes are append-only and carry ' +
            'the author and the time.',
          parameters: [staffLeadIdParameter],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/StaffLeadNoteRequest' } },
            },
          },
          responses: {
            '201': {
              description: 'The note was added.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/StaffLeadNote' } },
              },
            },
            '400': staffBadRequestResponse,
            '401': unauthenticatedResponse,
            '403': forbiddenResponse,
            '404': staffNotFoundResponse,
            '503': unavailableResponse,
            '500': serverErrorResponse,
          },
        },
      },
      '/staff/leads/{id}/assign': {
        post: {
          operationId: 'assignStaffLead',
          summary: 'Assign a verified lead to an agent',
          description:
            'Requires the Admin, SuperAdmin or Moderator role. The lead must be `verified`. The ' +
            'agent must be active and licensed in the state of the listing. Only the licence ' +
            'state and the listing state decide a match. The request has no reason field. The ' +
            'lead moves to `assigned` and the assignment is recorded.',
          parameters: [staffLeadIdParameter],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StaffLeadAssignRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'The lead moved to `assigned`.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StaffLeadAssignResponse' },
                },
              },
            },
            '400': staffBadRequestResponse,
            '401': unauthenticatedResponse,
            '403': forbiddenResponse,
            '404': {
              description: 'No lead or no agent profile has this id (`not_found`).',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
              },
            },
            '409': staffConflictResponse(
              'The lead is not `verified`, the agent is not active, or the agent is not ' +
                'licensed in the state of the listing (`conflict`).',
            ),
            '503': unavailableResponse,
            '500': serverErrorResponse,
          },
        },
      },
      '/staff/leads/{id}/unassign': {
        post: {
          operationId: 'unassignStaffLead',
          summary: 'Return an assigned lead to verified',
          description:
            'Requires the Admin, SuperAdmin or Moderator role. A note is required. The open ' +
            'assignment ends and the lead returns to `verified`. To reassign, unassign, then ' +
            'assign.',
          parameters: [staffLeadIdParameter],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StaffLeadUnassignRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'The lead returned to `verified`.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StaffLeadTransitionResponse' },
                },
              },
            },
            '400': staffBadRequestResponse,
            '401': unauthenticatedResponse,
            '403': forbiddenResponse,
            '404': staffNotFoundResponse,
            '409': staffConflictResponse(
              'The lead has no open assignment, or the transitions table does not allow the ' +
                'change (`conflict`).',
            ),
            '503': unavailableResponse,
            '500': serverErrorResponse,
          },
        },
      },
      '/staff/agents': {
        get: {
          operationId: 'listStaffAgents',
          summary: 'The agent directory',
          description:
            'Requires the Admin, SuperAdmin or Moderator role. Every profile, ordered by display ' +
            'name. The response is `private, no-store`.',
          parameters: searchParameters(staffAgentsRequestSchema),
          responses: {
            '200': {
              description: 'The agent profiles.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StaffAgentsEnvelope' },
                },
              },
            },
            '400': staffBadRequestResponse,
            '401': unauthenticatedResponse,
            '403': forbiddenResponse,
            '503': unavailableResponse,
            '500': serverErrorResponse,
          },
        },
        post: {
          operationId: 'createStaffAgent',
          summary: 'Create an agent profile',
          description:
            'Requires the Admin or SuperAdmin role. The account must hold the `Agent` role. ' +
            'account-service answers that check with the caller credentials. One profile per ' +
            'account.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateAgentProfileRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'The profile was created.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/AgentProfile' } },
              },
            },
            '400': staffBadRequestResponse,
            '401': unauthenticatedResponse,
            '403': forbiddenResponse,
            '409': staffConflictResponse(
              'The account has no `Agent` role, or already has a profile (`conflict`).',
            ),
            '503': unavailableResponse,
            '500': serverErrorResponse,
          },
        },
      },
      '/staff/agents/{id}': {
        get: {
          operationId: 'getStaffAgent',
          summary: 'One agent profile',
          description: 'Requires the Admin, SuperAdmin or Moderator role.',
          parameters: [staffAgentIdParameter],
          responses: {
            '200': {
              description: 'The profile.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/AgentProfile' } },
              },
            },
            '401': unauthenticatedResponse,
            '403': forbiddenResponse,
            '404': staffAgentNotFoundResponse,
            '503': unavailableResponse,
            '500': serverErrorResponse,
          },
        },
        patch: {
          operationId: 'updateStaffAgent',
          summary: 'Edit, deactivate or reactivate an agent profile',
          description:
            'Requires the Admin or SuperAdmin role. `active: false` deactivates the agent: no ' +
            'new leads, open assignments stay. Reactivation checks the `Agent` role again. The ' +
            'account never changes.',
          parameters: [staffAgentIdParameter],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateAgentProfileRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'The updated profile.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/AgentProfile' } },
              },
            },
            '400': staffBadRequestResponse,
            '401': unauthenticatedResponse,
            '403': forbiddenResponse,
            '404': staffAgentNotFoundResponse,
            '409': staffConflictResponse(
              'Reactivation needs the `Agent` role, and the account has none (`conflict`).',
            ),
            '503': unavailableResponse,
            '500': serverErrorResponse,
          },
        },
      },
    },
    components: {
      schemas: componentSchemas(),
    },
  };
}

export type OpenApiDocument = ReturnType<typeof toOpenApiDocument>;
