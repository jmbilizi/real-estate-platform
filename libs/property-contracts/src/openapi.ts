import { z } from 'zod';
import { idSchema } from './common';
import { listingCardSchema, listingsEnvelopeSchema } from './listing-card';
import { listingDetailSchema } from './listing-detail';
import { listingsMetaSchema } from './listings-meta';
import { errorBodySchema } from './errors';
import { searchRequestSchema } from './search-request';

/**
 * `unrepresentable` is deliberately left at its default (`'throw'`), not `'any'`. `'any'` would
 * make the next schema change that adds a transform on an output path render as a silent `{}` in
 * this frozen contract instead of failing the test run — exactly the trap this package's own
 * CLAUDE.md warns about. If a future schema genuinely can't be represented, the fix is to reshape
 * the schema (as `queryInt`/`queryBathCount` already do for coerced query params), not to paper
 * over it here.
 */
const schema = (value: z.ZodType, io: 'input' | 'output' = 'output') =>
  z.toJSONSchema(value, { target: 'openapi-3.0', io });

/** Query parameters, derived from the request schema so the two cannot drift. */
function searchParameters() {
  const requestJsonSchema = schema(searchRequestSchema, 'input') as {
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
  registry.add(listingsMetaSchema, { id: 'ListingsMeta' });
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
      // Singular, and deliberately not "Listings API": property-service owns the whole
      // Communities → Properties → Units → Listings hierarchy, so `listings` is one resource
      // within this API rather than the name of it. The paths below stay `/listings/*` — a
      // service name is not a resource name.
      title: 'Cribstop Property API',
      version: '1.0.0',
      description:
        'The Property API. `property-service` owns the Communities → Properties → Units → ' +
        'Listings hierarchy; `listings` is the resource this version of the document exposes, and ' +
        'a later resource extends THIS document rather than publishing a second one — the ' +
        'aggregation key is part of the docs URL, so splitting would break every bookmark. Every ' +
        'response carries the full ' +
        'broker/office attribution block (NAR 7.58, PRD §6.2), there is no field-selection ' +
        'parameter, and unknown query parameters are rejected with 400 — so no caller can omit ' +
        'it. Results are read through a compliance-enforcing view, so seller-suppressed ' +
        'listings are absent rather than redacted. Free-text `query` matches title, address, ' +
        'city, neighborhood and zip — never the description, which is third-party MLS remarks ' +
        'carrying a moderation state; making it searchable would turn phrases like "great for ' +
        'families" into matchable terms, i.e. keyword-based steering (PRD §6.3).',
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
