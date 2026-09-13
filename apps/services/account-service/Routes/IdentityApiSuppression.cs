// <copyright file="IdentityApiSuppression.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Routes;

/// <summary>
/// Takes Identity's own password-reset endpoints out of service.
/// </summary>
/// <remarks>
/// <para>
/// <c>MapIdentityApi</c> maps <c>POST /forgotPassword</c> and <c>POST /resetPassword</c>
/// unconditionally. Both are unusable here and, worse, unusable <em>quietly</em>: the request
/// endpoint issues a token only for an address whose <c>IsEmailConfirmedAsync</c> is true, and
/// nothing in this platform ever confirms an address, so it returns 200 having done nothing at all.
/// Left mapped, they would sit alongside <see cref="PasswordReset"/> as a second, silently broken
/// way to ask for a reset — which is the exact failure this service is being fixed to stop making.
/// </para>
/// <para>
/// They are removed rather than re-pointed because two endpoints cannot share a route template:
/// mapping our own handler at the same path would be an ambiguous match at request time, not an
/// override. A 404 is the honest answer — the path is gone, and a caller still using it finds out
/// immediately instead of being told a lie. They are dropped from the OpenAPI document too, since
/// that document is aggregated into the gateway's public Swagger UI.
/// </para>
/// <para>
/// The replacement runs in <see cref="IEndpointConventionBuilder.Finally"/> rather than as an
/// ordinary convention: the minimal-API request delegate is built <em>after</em> conventions run,
/// so a request delegate assigned any earlier would simply be overwritten.
/// </para>
/// </remarks>
internal static class IdentityApiSuppression
{
    private static readonly string[] SuppressedSuffixes =
    [
        "/forgotPassword",
        "/resetPassword",
    ];

    /// <summary>
    /// Suppresses Identity's built-in password-reset endpoints within the given group.
    /// </summary>
    /// <typeparam name="T">The convention builder type.</typeparam>
    /// <param name="builder">The convention builder for the group <c>MapIdentityApi</c> was mapped into.</param>
    /// <returns>The same builder, for chaining.</returns>
    internal static T SuppressIdentityPasswordResetEndpoints<T>(this T builder)
        where T : IEndpointConventionBuilder
    {
        builder.Finally(endpointBuilder =>
        {
            if (endpointBuilder is not RouteEndpointBuilder routeBuilder)
            {
                return;
            }

            var pattern = routeBuilder.RoutePattern.RawText;
            if (pattern is null || !SuppressedSuffixes.Any(
                suffix => pattern.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)))
            {
                return;
            }

            routeBuilder.Metadata.Add(new SuppressedEndpointMetadata());
            routeBuilder.RequestDelegate = static context =>
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return Task.CompletedTask;
            };
        });

        return builder;
    }

    /// <summary>
    /// Marks a suppressed endpoint as absent from the OpenAPI document.
    /// </summary>
    private sealed class SuppressedEndpointMetadata : IExcludeFromDescriptionMetadata
    {
        public bool ExcludeFromDescription => true;
    }
}
