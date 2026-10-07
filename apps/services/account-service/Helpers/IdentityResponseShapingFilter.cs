// <copyright file="IdentityResponseShapingFilter.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.Data;

namespace AccountService.Helpers;

/// <summary>
/// Collapses the <c>/login</c> failures that would otherwise disclose whether an address has an
/// account. Product requirement on #147.
/// </summary>
/// <remarks>
/// <c>NotAllowed</c> (unconfirmed) and <c>Lockedout</c> collapse into <c>Failed</c>.
/// <c>RequiresTwoFactor</c> stays because the client drives the flow from it.
/// </remarks>
internal sealed class IdentityResponseShapingFilter : IEndpointFilter
{
    private static readonly HashSet<string> CollapsedSignInDetails = new(StringComparer.Ordinal)
    {
        SignInResult.NotAllowed.ToString(),
        SignInResult.LockedOut.ToString(),
    };

    /// <inheritdoc/>
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var result = await next(context).ConfigureAwait(false);

        // Identity's handlers return Results<...> unions. Unwrap to the concrete result.
        if (result is INestedHttpResult nested)
        {
            result = nested.Result;
        }

        switch (FindRequest(context))
        {
            case LoginRequest when result is ProblemHttpResult { StatusCode: StatusCodes.Status401Unauthorized } problem
                && problem.ProblemDetails.Detail is { } detail
                && CollapsedSignInDetails.Contains(detail):
                return TypedResults.Problem(SignInResult.Failed.ToString(), statusCode: StatusCodes.Status401Unauthorized);

            default:
                return result;
        }
    }

    private static object? FindRequest(EndpointFilterInvocationContext context)
    {
        for (var i = 0; i < context.Arguments.Count; i++)
        {
            if (context.Arguments[i] is LoginRequest)
            {
                return context.Arguments[i];
            }
        }

        return null;
    }
}
