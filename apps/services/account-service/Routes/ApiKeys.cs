// <copyright file="ApiKeys.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using AccountService.Configuration;
using AccountService.Data;
using AccountService.Dtos;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AccountService.Routes;

internal static class ApiKeys
{
    private const string KeyPrefix = "rep_";
    private const int KeyLength = 40;
    private const int PrefixVisibleChars = 8;
    private const int MaxKeysPerUser = 10;
    private static readonly char[] Base62Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();
    private static readonly string[] ExpirationMustBeFutureError = new[] { "Expiration must be in the future." };
    private static readonly string[] MaxKeysError = new[] { $"Maximum of {MaxKeysPerUser} active API keys per user." };
    private static readonly string[] InvalidAppIdError = new[] { "AppId is not a recognised application identifier." };

    internal static IEndpointRouteBuilder MapApiKeyRoutes(this IEndpointRouteBuilder app)
    {
        // POST /account/api-keys — create a new API key (returns the raw key exactly once)
        app.MapPost("/account/api-keys", async (
            CreateApiKeyRequest request,
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager,
            AccountDbContext db,
            IOptions<AppSettings> appSettings) =>
        {
            var user = await userManager.GetUserAsync(principal).ConfigureAwait(false);
            if (user is null || user.DeletedAt.HasValue)
            {
                return Results.Unauthorized();
            }

            if (request.ExpiresAt.HasValue && request.ExpiresAt.Value <= DateTime.UtcNow)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["expiresAt"] = ExpirationMustBeFutureError,
                });
            }

            if (!string.IsNullOrEmpty(request.AppId)
                && !appSettings.Value.AllowedApps.Contains(request.AppId, StringComparer.OrdinalIgnoreCase))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["appId"] = InvalidAppIdError,
                });
            }

            var existingCount = await db.ApiKeys
                .CountAsync(k => k.UserId == user.Id && k.RevokedAt == null)
                .ConfigureAwait(false);

            if (existingCount >= MaxKeysPerUser)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["apiKeys"] = MaxKeysError,
                });
            }

            var rawKey = GenerateRawKey();
            var keyHash = HashKey(rawKey);
            var prefix = rawKey[..(KeyPrefix.Length + PrefixVisibleChars)];

            var apiKey = new ApiKey
            {
                Id = Guid.NewGuid().ToString(),
                UserId = user.Id,
                Name = request.Name,
                Prefix = prefix,
                KeyHash = keyHash,
                AppId = request.AppId,
                Scopes = request.Scopes,
                ExpiresAt = request.ExpiresAt,
            };

            db.ApiKeys.Add(apiKey);
            await db.SaveChangesAsync().ConfigureAwait(false);

            return Results.Created($"/account/api-keys/{apiKey.Id}", new
            {
                apiKey.Id,
                apiKey.Name,
                apiKey.Prefix,
                apiKey.AppId,
                apiKey.Scopes,
                apiKey.ExpiresAt,
                apiKey.CreatedAt,
                Key = rawKey,
            });
        }).RequireAuthorization();

        // GET /account/api-keys — list the current user's API keys (never returns raw keys)
        app.MapGet("/account/api-keys", async (
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager,
            AccountDbContext db) =>
        {
            var user = await userManager.GetUserAsync(principal).ConfigureAwait(false);
            if (user is null || user.DeletedAt.HasValue)
            {
                return Results.Unauthorized();
            }

            var keys = await db.ApiKeys
                .Where(k => k.UserId == user.Id)
                .OrderByDescending(k => k.CreatedAt)
                .Select(k => new
                {
                    k.Id,
                    k.Name,
                    k.Prefix,
                    k.AppId,
                    k.Scopes,
                    k.ExpiresAt,
                    k.LastUsedAt,
                    k.RevokedAt,
                    k.CreatedAt,
                })
                .ToListAsync()
                .ConfigureAwait(false);

            return Results.Ok(keys);
        }).RequireAuthorization();

        // DELETE /account/api-keys/{id} — revoke an API key (soft-delete via RevokedAt)
        app.MapDelete("/account/api-keys/{id}", async (
            string id,
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager,
            AccountDbContext db) =>
        {
            var user = await userManager.GetUserAsync(principal).ConfigureAwait(false);
            if (user is null || user.DeletedAt.HasValue)
            {
                return Results.Unauthorized();
            }

            var apiKey = await db.ApiKeys
                .FirstOrDefaultAsync(k => k.Id == id && k.UserId == user.Id)
                .ConfigureAwait(false);

            if (apiKey is null)
            {
                return Results.NotFound();
            }

            if (apiKey.RevokedAt.HasValue)
            {
                return Results.NoContent();
            }

            apiKey.RevokedAt = DateTime.UtcNow;
            await db.SaveChangesAsync().ConfigureAwait(false);

            return Results.NoContent();
        }).RequireAuthorization();

        return app;
    }

    internal static string HashKey(string rawKey)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(rawKey));
        return Convert.ToHexStringLower(hash);
    }

    private static string GenerateRawKey()
    {
        var bytes = RandomNumberGenerator.GetBytes(KeyLength);
        var chars = new char[KeyLength];
        for (var i = 0; i < KeyLength; i++)
        {
            chars[i] = Base62Chars[bytes[i] % Base62Chars.Length];
        }

        return KeyPrefix + new string(chars);
    }
}
