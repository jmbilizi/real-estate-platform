// <copyright file="IdentityEndpoints.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Helpers;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.Data;
using Microsoft.Extensions.Primitives;

namespace AccountService.Routes;

/// <summary>
/// Maps the Identity endpoints this service keeps: <c>login</c>, <c>refresh</c>,
/// <c>forgotPassword</c>, <c>resetPassword</c> and <c>manage/*</c>.
/// </summary>
/// <remarks>
/// <para>
/// <c>MapIdentityApi</c> also maps <c>/register</c>, <c>/confirmEmail</c> and
/// <c>/resendConfirmationEmail</c>. Those three are retired (#657): a verified code is the only way
/// to create an account, so <c>/register</c> must not exist. They are mapped into a detached route
/// builder, and a wrapper data source hides them before the app sees them. The routes are absent,
/// not filtered, so no handler is reachable and the router answers <c>404</c>.
/// </para>
/// <para>
/// Hand-mapping the kept endpoints was the other option. It would copy Identity's cookie, bearer
/// and refresh handlers, and the copy would drift from the framework. Hiding three routes keeps the
/// kept handlers the framework's own. <c>AccountCreationSurfaceTests</c> pins the result.
/// </para>
/// </remarks>
internal static class IdentityEndpoints
{
    /// <summary>The Identity routes this service does not expose.</summary>
    internal static readonly string[] RetiredPaths =
    [
        "/account/register",
        "/account/confirmEmail",
        "/account/resendConfirmationEmail",
    ];

    internal static void MapRetainedIdentityApi(this WebApplication app)
    {
        var detached = new DetachedEndpointRouteBuilder(app);
        var group = detached.MapGroup("/account");
        group.MapIdentityApi<ApplicationUser>();
        group.AddEndpointFilter<AccountRecoveryThrottleFilter>();
        group.AddEndpointFilter<IdentityResponseShapingFilter>();
        group.AddEndpointFilter<EmailChangeRetiredFilter>();
        group.AddEndpointFilter<PasswordChangeFilter>();

        ((IEndpointRouteBuilder)app).DataSources.Add(
            new RetainedEndpointDataSource(detached.DataSources));
    }

    /// <summary>
    /// Takes over <c>POST /manage/info</c> with a new password (#661). The framework branch does not
    /// count a wrong current password toward the lockout and writes no security event. This filter
    /// runs <see cref="PasswordChangeService"/> and signs the caller in again, so the new security
    /// stamp ends every other session and keeps this one. The endpoint stays for the other fields.
    /// </summary>
    private sealed class PasswordChangeFilter : IEndpointFilter
    {
        public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
        {
            ArgumentNullException.ThrowIfNull(context);
            ArgumentNullException.ThrowIfNull(next);

            var request = context.Arguments.OfType<InfoRequest>().FirstOrDefault();
            if (request is not { NewPassword: { Length: > 0 } })
            {
                return await next(context).ConfigureAwait(false);
            }

            var http = context.HttpContext;
            var session = await CallerSession.ReadAsync(http).ConfigureAwait(false);
            if (session is null)
            {
                return Results.Json(new { error = EmailChange.SessionRequiredError }, statusCode: StatusCodes.Status403Forbidden);
            }

            var result = await http.RequestServices.GetRequiredService<PasswordChangeService>()
                .ChangeAsync(
                    session.UserId,
                    request.OldPassword,
                    request.NewPassword,
                    AccountRecoveryThrottleFilter.ClientAddress(http),
                    http.RequestAborted)
                .ConfigureAwait(false);

            switch (result.Status)
            {
                case PasswordChangeStatus.Changed:
                    // The new stamp ended this session too. SignInAsync builds the new one from the changed account.
                    var signIn = http.RequestServices.GetRequiredService<SignInManager<ApplicationUser>>();
                    signIn.AuthenticationScheme = session.Bearer ? IdentityConstants.BearerScheme : IdentityConstants.ApplicationScheme;
                    await signIn.SignInAsync(result.User!, session.Persistent).ConfigureAwait(false);
                    return Results.Empty;
                case PasswordChangeStatus.CurrentRequired:
                    return Problem("OldPasswordRequired", "The current password is required.");
                case PasswordChangeStatus.CurrentWrong:
                    return Problem("PasswordMismatch", "Incorrect password.");
                case PasswordChangeStatus.PasswordRejected:
                    return Results.ValidationProblem(result.Errors!.ToDictionary(e => e.Key, e => new[] { e.Value }));
                case PasswordChangeStatus.Limited:
                    http.Response.Headers.RetryAfter = result.RetryAfterSeconds?.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    return Results.Json(new { error = "limited" }, statusCode: StatusCodes.Status429TooManyRequests);
                default:
                    return Results.Unauthorized();
            }
        }

        private static IResult Problem(string code, string message) =>
            Results.ValidationProblem(new Dictionary<string, string[]> { [code] = new[] { message } });
    }

    private sealed class DetachedEndpointRouteBuilder(WebApplication app) : IEndpointRouteBuilder
    {
        public IServiceProvider ServiceProvider => app.Services;

        public ICollection<EndpointDataSource> DataSources { get; } = new List<EndpointDataSource>();

        public IApplicationBuilder CreateApplicationBuilder() => ((IEndpointRouteBuilder)app).CreateApplicationBuilder();
    }

    private sealed class RetainedEndpointDataSource(IEnumerable<EndpointDataSource> sources) : EndpointDataSource
    {
        public override IReadOnlyList<Endpoint> Endpoints => sources.SelectMany(source => source.Endpoints)
            .Where(endpoint => endpoint is not RouteEndpoint route
                || !RetiredPaths.Contains(route.RoutePattern.RawText, StringComparer.OrdinalIgnoreCase))
            .ToList();

        public override IChangeToken GetChangeToken() =>
            new CompositeChangeToken(sources.Select(source => source.GetChangeToken()).ToList());
    }

    /// <summary>
    /// Refuses <c>POST /manage/info</c> with a new email. Identity answers it by mailing a
    /// confirmation link built from the retired <c>/confirmEmail</c> route, which would throw.
    /// A change of email by code is separate work.
    /// </summary>
    private sealed class EmailChangeRetiredFilter : IEndpointFilter
    {
        private static readonly string[] EmailChangeMessage = new[] { "Changing the email address is not available here." };

        public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
        {
            ArgumentNullException.ThrowIfNull(context);
            ArgumentNullException.ThrowIfNull(next);

            foreach (var argument in context.Arguments)
            {
                if (argument is InfoRequest { NewEmail: { Length: > 0 } })
                {
                    return ValueTask.FromResult<object?>(Results.ValidationProblem(
                        new Dictionary<string, string[]> { ["newEmail"] = EmailChangeMessage }));
                }
            }

            return next(context);
        }
    }
}
