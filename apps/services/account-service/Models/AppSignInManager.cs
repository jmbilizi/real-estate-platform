// <copyright file="AppSignInManager.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using AccountService.Configuration;
using AccountService.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace AccountService.Models;

/// <summary>
/// Custom SignInManager that updates <see cref="ApplicationUser.LastLoginAt"/> and upserts a
/// <see cref="UserApp"/> row whenever a user signs in via any scheme (cookie or bearer token).
/// The app identity is taken from the <c>X-App-Id</c> request header, which Ocelot adds
/// automatically based on the route configuration.
/// </summary>
[System.Diagnostics.CodeAnalysis.SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by dependency injection.")]
internal sealed class AppSignInManager(
    UserManager<ApplicationUser> userManager,
    IHttpContextAccessor contextAccessor,
    IUserClaimsPrincipalFactory<ApplicationUser> claimsFactory,
    Microsoft.Extensions.Options.IOptions<IdentityOptions> optionsAccessor,
    ILogger<SignInManager<ApplicationUser>> logger,
    Microsoft.AspNetCore.Authentication.IAuthenticationSchemeProvider schemes,
    IUserConfirmation<ApplicationUser> confirmation,
    AccountDbContext db,
    Microsoft.Extensions.Options.IOptions<AppSettings> appSettings)
    : SignInManager<ApplicationUser>(
        userManager, contextAccessor, claimsFactory,
        optionsAccessor, logger, schemes, confirmation)
{
    // Stored separately to avoid CS9107 (base constructor also captures contextAccessor).
    private readonly IHttpContextAccessor httpContextAccessor = contextAccessor;

    /// <inheritdoc/>
    public override async Task SignInWithClaimsAsync(
        ApplicationUser user,
        Microsoft.AspNetCore.Authentication.AuthenticationProperties? authenticationProperties,
        IEnumerable<Claim> additionalClaims)
    {
        await base.SignInWithClaimsAsync(user, authenticationProperties, additionalClaims)
            .ConfigureAwait(false);

        try
        {
            await RecordLoginAsync(user).ConfigureAwait(false);
        }
#pragma warning disable CA1031, CA1848 // Intentional broad catch: tracking is non-critical and must not interrupt sign-in
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to record login tracking for user {UserId}; sign-in will proceed.", user.Id);
        }
#pragma warning restore CA1031, CA1848
    }

    private async Task RecordLoginAsync(ApplicationUser user)
    {
        user.LastLoginAt = DateTime.UtcNow;

        var appId = httpContextAccessor.HttpContext?.Request.Headers["X-App-Id"].ToString();

        if (!string.IsNullOrEmpty(appId)
            && appSettings.Value.AllowedApps.Contains(appId, StringComparer.OrdinalIgnoreCase))
        {
            if (db.Database.IsRelational())
            {
                // Atomic upsert — eliminates the read-modify-write race under concurrent logins.
                // FormattableString interpolation is automatically parameterized by EF Core (safe from SQL injection).
                await db.Database.ExecuteSqlAsync(
                    $"""
                    INSERT INTO "UserApps" ("UserId", "AppId", "FirstSeenAt", "LastSeenAt")
                    VALUES ({user.Id}, {appId}, NOW(), NOW())
                    ON CONFLICT ("UserId", "AppId") DO UPDATE SET "LastSeenAt" = NOW()
                    """).ConfigureAwait(false);
            }
            else
            {
                // InMemory provider (unit/integration tests) does not support raw SQL — use EF change tracking.
                var existing = await db.UserApps
                    .FirstOrDefaultAsync(ua => ua.UserId == user.Id && ua.AppId == appId)
                    .ConfigureAwait(false);

                if (existing is null)
                {
                    db.UserApps.Add(new UserApp
                    {
                        UserId = user.Id,
                        AppId = appId,
                        FirstSeenAt = DateTime.UtcNow,
                        LastSeenAt = DateTime.UtcNow,
                    });
                }
                else
                {
                    existing.LastSeenAt = DateTime.UtcNow;
                }
            }
        }

        await db.SaveChangesAsync().ConfigureAwait(false);
    }
}
