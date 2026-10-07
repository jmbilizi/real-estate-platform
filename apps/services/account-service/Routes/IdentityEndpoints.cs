// <copyright file="IdentityEndpoints.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Helpers;
using AccountService.Models;
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

        ((IEndpointRouteBuilder)app).DataSources.Add(
            new RetainedEndpointDataSource(detached.DataSources));
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
