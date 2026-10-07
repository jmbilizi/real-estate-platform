// <copyright file="CallerSession.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Helpers;

/// <summary>How the caller signed in: the account, and a bearer token or a cookie.</summary>
/// <param name="UserId">The account id.</param>
/// <param name="Bearer"><see langword="true"/> for a bearer token, <see langword="false"/> for a cookie.</param>
/// <param name="Persistent">Whether the cookie outlives the browser session.</param>
internal sealed record CallerSession(string UserId, bool Bearer, bool Persistent)
{
    /// <summary>
    /// Reads how the caller signed in. Returns null for an API key. The default policy has already
    /// run each scheme, and a handler keeps its result for the request, so these calls read that
    /// result and do not validate again after a change rotates the stamp.
    /// </summary>
    /// <param name="http">The request.</param>
    /// <returns>The session, or <see langword="null"/> when the caller has no cookie or bearer session.</returns>
    internal static async Task<CallerSession?> ReadAsync(HttpContext http)
    {
        ArgumentNullException.ThrowIfNull(http);

        var userId = http.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(userId))
        {
            return null;
        }

        var bearer = await http.AuthenticateAsync(IdentityConstants.BearerScheme).ConfigureAwait(false);
        if (bearer.Succeeded)
        {
            return new CallerSession(userId, true, false);
        }

        var cookie = await http.AuthenticateAsync(IdentityConstants.ApplicationScheme).ConfigureAwait(false);
        return cookie.Succeeded
            ? new CallerSession(userId, false, cookie.Properties?.IsPersistent == true)
            : null;
    }
}
