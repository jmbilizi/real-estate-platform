// <copyright file="CredentialIntrospection.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Helpers;

namespace AccountService.Routes;

/// <summary>
/// Internal service-to-service endpoint that resolves a credential forwarded verbatim by the
/// gateway (session cookie, opaque bearer token, or API key) to an account id.
/// </summary>
internal static class CredentialIntrospection
{
    private const string IntrospectionPath = "/internal/account/introspect";

    /// <summary>
    /// Maps <c>POST /internal/account/introspect</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Not consumer-facing.</b> The gateway's broadest route is <c>/account/{everything}</c>, so
    /// <c>/internal/**</c> has no public route, and <c>account-service-svc</c> is a ClusterIP Service
    /// with no Ingress. The endpoint is also excluded from the OpenAPI document, because that document
    /// is aggregated into the gateway's publicly served Swagger UI — reachability and advertisement are
    /// separate problems and both have to be closed.
    /// </para>
    /// <para>
    /// Responses are <c>no-store</c>: any caller-side caching would defeat the immediate revocation this
    /// endpoint exists to provide.
    /// </para>
    /// </remarks>
    /// <param name="app">The endpoint route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    internal static IEndpointRouteBuilder MapCredentialIntrospectionRoutes(this IEndpointRouteBuilder app)
    {
        app.MapPost(IntrospectionPath, async (
            HttpContext context,
            CredentialIntrospector introspector) =>
        {
            SetNoStoreHeaders(context.Response);

            var result = await introspector.IntrospectAsync(context.Request).ConfigureAwait(false);
            return Results.Ok(result);
        })
        .DisableAntiforgery()
        .ExcludeFromDescription();

        return app;
    }

    private static void SetNoStoreHeaders(HttpResponse response)
    {
        response.Headers.CacheControl = "no-store, no-cache, max-age=0";
        response.Headers.Pragma = "no-cache";
        response.Headers.Expires = "0";
    }
}
