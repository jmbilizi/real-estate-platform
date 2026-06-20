// <copyright file="ApiKeyAuthenticationHandler.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using System.Text.Encodings.Web;
using AccountService.Data;
using AccountService.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Authentication handler that validates requests carrying an API key in the X-Api-Key header.
/// On success, establishes a ClaimsPrincipal with the key owner's identity and roles.
/// </summary>
internal sealed class ApiKeyAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IServiceScopeFactory scopeFactory)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(ApiKeyDefaults.HeaderName, out var headerValues))
        {
            return AuthenticateResult.NoResult();
        }

        var rawKey = headerValues.ToString();
        if (string.IsNullOrWhiteSpace(rawKey))
        {
            return AuthenticateResult.NoResult();
        }

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();

        var keyHash = Routes.ApiKeys.HashKey(rawKey);

        var apiKey = await db.ApiKeys
            .Include(k => k.User)
            .FirstOrDefaultAsync(k => k.KeyHash == keyHash)
            .ConfigureAwait(false);

        if (apiKey is null)
        {
            return AuthenticateResult.Fail("Invalid API key.");
        }

        if (apiKey.RevokedAt.HasValue)
        {
            return AuthenticateResult.Fail("API key has been revoked.");
        }

        if (apiKey.ExpiresAt.HasValue && apiKey.ExpiresAt.Value <= DateTime.UtcNow)
        {
            return AuthenticateResult.Fail("API key has expired.");
        }

        if (apiKey.User is null || apiKey.User.DeletedAt.HasValue)
        {
            return AuthenticateResult.Fail("Account associated with this API key is unavailable.");
        }

        // Update LastUsedAt and record app usage — non-critical; exceptions are logged, not thrown.
        try
        {
            apiKey.LastUsedAt = DateTime.UtcNow;

            if (!string.IsNullOrEmpty(apiKey.AppId))
            {
                var existing = await db.UserApps
                    .FirstOrDefaultAsync(ua => ua.UserId == apiKey.User.Id && ua.AppId == apiKey.AppId)
                    .ConfigureAwait(false);

                if (existing is null)
                {
                    db.UserApps.Add(new UserApp
                    {
                        UserId = apiKey.User.Id,
                        AppId = apiKey.AppId,
                        FirstSeenAt = DateTime.UtcNow,
                        LastSeenAt = DateTime.UtcNow,
                    });
                }
                else
                {
                    existing.LastSeenAt = DateTime.UtcNow;
                }
            }

            await db.SaveChangesAsync().ConfigureAwait(false);
        }
#pragma warning disable CA1031, CA1848 // Intentional broad catch: usage tracking is non-critical and must not interrupt authentication
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to update usage tracking for API key {KeyId}; authentication will proceed.", apiKey.Id);
        }
#pragma warning restore CA1031, CA1848

        // Build claims principal with the user's identity and roles
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, apiKey.User.Id),
            new(ClaimTypes.Name, apiKey.User.UserName ?? apiKey.User.Email ?? apiKey.User.Id),
            new(ClaimTypes.Email, apiKey.User.Email ?? string.Empty),
            new("api_key_id", apiKey.Id),
        };

        var roles = await userManager.GetRolesAsync(apiKey.User).ConfigureAwait(false);
        foreach (var role in roles)
        {
            claims.Add(new Claim(ClaimTypes.Role, role));
        }

        var identity = new ClaimsIdentity(claims, ApiKeyDefaults.AuthenticationScheme);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, ApiKeyDefaults.AuthenticationScheme);

        return AuthenticateResult.Success(ticket);
    }
}
