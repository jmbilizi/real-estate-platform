import axios from 'axios';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `GET /openapi.json` against a REAL running service — this is the document
 * `MMLib.SwaggerForOcelot` aggregates on the gateway, so it must actually match what the gateway
 * expects to find.
 */

describe('published document identity', () => {
  it('serves the Property API document with info.title, exactly three paths, and the three operation ids', async () => {
    const response = await axios.get('/openapi.json');

    expect(response.status).toBe(200);
    expect(response.data.info.title).toBe('Property Service');
    expect(Object.keys(response.data.paths).sort()).toEqual([
      '/listings',
      '/listings/meta',
      '/listings/{id}',
    ]);
    expect(response.data.paths['/listings'].get.operationId).toBe('searchListings');
    expect(response.data.paths['/listings/meta'].get.operationId).toBe('getListingsMeta');
    expect(response.data.paths['/listings/{id}'].get.operationId).toBe('getListing');
  });
});

describe('no field-selection parameter is published', () => {
  it('never advertises fields/select/include/omit/exclude on GET /listings — a published field-selection parameter would be a structural way to strip the NAR 7.58 attribution block', async () => {
    const response = await axios.get('/openapi.json');
    const parameters = response.data.paths['/listings'].get.parameters as { name: string }[];
    const names = parameters.map((parameter) => parameter.name);

    for (const forbidden of ['fields', 'select', 'include', 'omit', 'exclude']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

/**
 * The published paths mirror the gateway's **downstream** templates, not its upstream ones. The
 * gateway namespaces this service at `/property/*` and Ocelot rewrites onto the `/listings/*` this
 * service actually serves, so `MMLib.SwaggerForOcelot` has to transform the document — which it can
 * only do by matching each published path against a `DownstreamPathTemplate`. That is what this
 * assertion pins, and it is why the route file must keep `TransformByOcelotConfig: true`: drift on
 * either side republishes paths the gateway does not expose and every "Try it out" 404s.
 */
describe('path templates match the gateway route file byte-for-byte', () => {
  it("has every published path present as a DownstreamPathTemplate in the gateway route file — a drift here leaves MMLib.SwaggerForOcelot's paths untransformed and the published spec 404s through the gateway", async () => {
    const response = await axios.get('/openapi.json');

    // tests/ -> property-service -> services -> apps -> api-gateway/Configuration/Routes/...
    const gatewayRoutesPath = join(
      __dirname,
      '..',
      '..',
      '..',
      'api-gateway',
      'Configuration',
      'Routes',
      'property-service-routes.json',
    );
    const gatewayConfig = JSON.parse(readFileSync(gatewayRoutesPath, 'utf8')) as {
      Routes: { DownstreamPathTemplate: string }[];
    };
    const gatewayTemplates = new Set(
      gatewayConfig.Routes.map((route) => route.DownstreamPathTemplate),
    );

    const publishedPaths = Object.keys(response.data.paths);
    expect(publishedPaths.length).toBeGreaterThan(0);
    for (const path of publishedPaths) {
      expect(gatewayTemplates.has(path)).toBe(true);
    }
  });
});
