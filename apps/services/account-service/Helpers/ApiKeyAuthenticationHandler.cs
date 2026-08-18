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

        var validation = await ApiKeyValidation.ValidateAsync(db, rawKey).ConfigureAwait(false);

        if (validation.Status != ApiKeyValidationStatus.Valid)
        {
            return AuthenticateResult.Fail(ApiKeyValidation.FailureMessage(validation.Status));
        }

        // Valid implies both are non-null; the local aliases keep the rest of the method readable.
        var apiKey = validation.ApiKey!;
        var keyOwner = apiKey.User!;

        // Update LastUsedAt and record app usage — non-critical; exceptions are logged, not thrown.
        try
        {
            apiKey.LastUsedAt = DateTime.UtcNow;

            if (!string.IsNullOrEmpty(apiKey.AppId))
            {
                var existing = await db.UserApps
                    .FirstOrDefaultAsync(ua => ua.UserId == keyOwner.Id && ua.AppId == apiKey.AppId)
                    .ConfigureAwait(false);

                if (existing is null)
                {
                    db.UserApps.Add(new UserApp
                    {
                        UserId = keyOwner.Id,
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
            new(ClaimTypes.NameIdentifier, keyOwner.Id),
            new(ClaimTypes.Name, keyOwner.UserName ?? keyOwner.Email ?? keyOwner.Id),
            new(ClaimTypes.Email, keyOwner.Email ?? string.Empty),
            new("api_key_id", apiKey.Id),
        };

        var roles = await userManager.GetRolesAsync(keyOwner).ConfigureAwait(false);
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
