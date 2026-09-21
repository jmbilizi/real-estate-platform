// <copyright file="IdentityResponseShapingFilter.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text;
using System.Text.Encodings.Web;
using AccountService.Models;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.Data;
using Microsoft.AspNetCore.WebUtilities;

namespace AccountService.Helpers;

/// <summary>
/// Reshapes three Identity responses that would otherwise disclose whether an address has an
/// account. Product requirement on #147, not a defect in Identity.
/// </summary>
/// <remarks>
/// <list type="bullet">
/// <item><c>/register</c>: a duplicate address answers exactly like a success. What happened is told
/// only to the mailbox owner: an unconfirmed account gets a fresh confirmation link, a confirmed
/// account gets an already-registered notice, both through the delivery seam (#138).</item>
/// <item><c>/login</c>: <c>NotAllowed</c> (unconfirmed) and <c>Lockedout</c> collapse into
/// <c>Failed</c>. <c>RequiresTwoFactor</c> stays because the client drives the flow from it.</item>
/// <item><c>/confirmEmail</c>: every failure answers one problem body that says only to request a
/// new link.</item>
/// </list>
/// </remarks>
/// <param name="links">The confirmation link builder.</param>
/// <param name="composer">The message composer, for the already-registered notice.</param>
/// <param name="rateLimiter">The shared counters, so a duplicate registration spends the resend budget.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class IdentityResponseShapingFilter(
    ConfirmationLinkBuilder links,
    IdentityEmailComposer composer,
    AccountRecoveryRateLimiter rateLimiter,
    ILogger<IdentityResponseShapingFilter> logger) : IEndpointFilter
{
    /// <summary>The body every failed confirmation returns.</summary>
    internal const string ConfirmationFailedDetail = "This confirmation link is not valid. Request a new link.";

    private static readonly HashSet<string> DuplicateCodes = new(StringComparer.Ordinal)
    {
        nameof(IdentityErrorDescriber.DuplicateUserName),
        nameof(IdentityErrorDescriber.DuplicateEmail),
    };

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
            case RegisterRequest register when IsDuplicateAddress(result):
                return await this.OnDuplicateRegistrationAsync(register.Email, context.HttpContext).ConfigureAwait(false);

            case LoginRequest when result is ProblemHttpResult { StatusCode: StatusCodes.Status401Unauthorized } problem
                && problem.ProblemDetails.Detail is { } detail
                && CollapsedSignInDetails.Contains(detail):
                return TypedResults.Problem(SignInResult.Failed.ToString(), statusCode: StatusCodes.Status401Unauthorized);

            case null when IsConfirmEmailEndpoint(context.HttpContext) && result is UnauthorizedHttpResult:
                return TypedResults.Problem(ConfirmationFailedDetail, statusCode: StatusCodes.Status401Unauthorized);

            default:
                return result;
        }
    }

    private static object? FindRequest(EndpointFilterInvocationContext context)
    {
        for (var i = 0; i < context.Arguments.Count; i++)
        {
            if (context.Arguments[i] is RegisterRequest or LoginRequest)
            {
                return context.Arguments[i];
            }
        }

        return null;
    }

    private static bool IsDuplicateAddress(object? result) =>
        result is ValidationProblem problem
        && problem.ProblemDetails.Errors.Count > 0
        && problem.ProblemDetails.Errors.Keys.All(DuplicateCodes.Contains);

    // The same endpoint name /register depends on to build its link.
    private static bool IsConfirmEmailEndpoint(HttpContext context) =>
        context.GetEndpoint()?.Metadata.GetMetadata<EndpointNameMetadata>()?.EndpointName
            is { } name && name.EndsWith("/confirmEmail", StringComparison.Ordinal);

    [LoggerMessage(1362, LogLevel.Information, "Registration attempted for {Email}, which already has a confirmed account. An already-registered notice was sent. The caller was answered as a success.", EventName = "RegistrationForConfirmedAddress")]
    private static partial void LogDuplicateConfirmed(ILogger logger, string email);

    [LoggerMessage(1363, LogLevel.Information, "Registration attempted for {Email}, which already has an unconfirmed account. Fresh confirmation link sent: {Sent}. The caller was answered as a success.", EventName = "RegistrationForUnconfirmedAddress")]
    private static partial void LogDuplicateUnconfirmed(ILogger logger, string email, bool sent);

    private async Task<IResult> OnDuplicateRegistrationAsync(string email, HttpContext httpContext)
    {
        // The filter instance is built once per endpoint from the root provider. Scoped services
        // come from the request.
        var userManager = httpContext.RequestServices.GetRequiredService<UserManager<ApplicationUser>>();
        var emailSender = httpContext.RequestServices.GetRequiredService<IEmailSender<ApplicationUser>>();

        var user = await userManager.FindByEmailAsync(email).ConfigureAwait(false);
        if (user is null)
        {
            return TypedResults.Ok();
        }

        if (await userManager.IsEmailConfirmedAsync(user).ConfigureAwait(false))
        {
            // #147's non-enumeration guarantee: the caller sees an ordinary success. Only the
            // mailbox owner is told, so an attacker cannot use registration to learn who has an
            // account.
            var outbound = httpContext.RequestServices.GetRequiredService<IOutboundEmailSender>();
            await outbound.SendAsync(composer.AlreadyRegistered(email)).ConfigureAwait(false);
            LogDuplicateConfirmed(logger, email);
            return TypedResults.Ok();
        }

        var clientAddress = AccountRecoveryThrottleFilter.ClientAddress(httpContext);
        var sent = false;
        if (rateLimiter.TryResend(email.Trim(), clientAddress, out _))
        {
            var code = await userManager.GenerateEmailConfirmationTokenAsync(user).ConfigureAwait(false);
            code = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(code));
            var userId = await userManager.GetUserIdAsync(user).ConfigureAwait(false);
            var link = links.Build(userId, code).ToString();
            await emailSender.SendConfirmationLinkAsync(user, email, HtmlEncoder.Default.Encode(link)).ConfigureAwait(false);
            sent = true;
        }

        LogDuplicateUnconfirmed(logger, email, sent);
        return TypedResults.Ok();
    }
}
