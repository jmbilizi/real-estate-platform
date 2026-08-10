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
