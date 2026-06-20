// <copyright file="UserAppClaimsTransformation.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using AccountService.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;

namespace AccountService.Helpers;

/// <summary>
/// Enriches an authenticated principal with <c>app_access</c> claims derived from the
/// <c>UserApps</c> table. One claim is added per app the user has previously authenticated with,
/// allowing Ocelot and downstream services to enforce per-app access without a database call.
/// </summary>
internal sealed class UserAppClaimsTransformation(AccountDbContext db) : IClaimsTransformation
{
    /// <inheritdoc/>
    public async Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(userId))
        {
            return principal;
        }

        // Skip if app_access claims are already present (transformation is called on every request).
        if (principal.HasClaim(c => c.Type == "app_access"))
        {
            return principal;
        }

        var appIds = await db.UserApps
            .Where(ua => ua.UserId == userId)
            .Select(ua => ua.AppId)
            .ToListAsync()
            .ConfigureAwait(false);

        if (appIds.Count == 0)
        {
            return principal;
        }

        // ClaimsPrincipal.Clone() does a shallow copy (same ClaimsIdentity instances);
        // use new ClaimsIdentity(id) to get a genuine deep copy with independent claims lists.
        var newIdentities = principal.Identities
            .Select(id => new ClaimsIdentity(id))
            .ToList();

        var primaryIdentity = newIdentities.Count > 0 ? newIdentities[0] : new ClaimsIdentity();
        foreach (var appId in appIds)
        {
            primaryIdentity.AddClaim(new Claim("app_access", appId));
        }

        return new ClaimsPrincipal(newIdentities);
    }
}
