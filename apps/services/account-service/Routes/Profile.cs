// <copyright file="Profile.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using AccountService.Dtos;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Routes;

internal static class Profile
{
    internal static IEndpointRouteBuilder MapProfileRoutes(this IEndpointRouteBuilder app)
    {
        // GET /account/profile — return the current user's extended profile
        app.MapGet("/account/profile", async (
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager) =>
        {
            var user = await userManager.GetUserAsync(principal).ConfigureAwait(false);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            if (user.DeletedAt.HasValue)
            {
                return Results.NotFound();
            }

            return Results.Ok(new
            {
                // Identity
                user.Id,
                user.Email,
                user.DisplayName,
                user.VerifiedAt,
                user.VerifiedByUserId,
                user.VerificationNote,
                user.AccountStatusId,
                user.LastLoginAt,

                // Name
                user.FirstName,
                user.LastName,
                user.MiddleName,

                // Personal
                user.Bio,
                user.DateOfBirth,

                // Media
                user.ProfileImageId,
                user.CoverImageId,

                // Preferences
                user.PreferredLocaleId,
                user.EmailNotificationsEnabled,
                user.SmsNotificationsEnabled,
                user.PushNotificationsEnabled,
                user.MarketingOptIn,

                // Audit
                user.CreatedAt,
                user.UpdatedAt,
            });
        }).RequireAuthorization();

        // PUT /account/profile — patch editable profile fields and push current state into the audit chain
        app.MapPut("/account/profile", async (
            UpdateProfileRequest request,
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager) =>
        {
            var user = await userManager.GetUserAsync(principal).ConfigureAwait(false);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            if (user.DeletedAt.HasValue)
            {
                return Results.NotFound();
            }

            // Deserialise previous chain so it nests as a real JSON object (not an escaped string)
            var previousChain = user.PreviousState is not null
                ? JsonSerializer.Deserialize<JsonElement>(user.PreviousState)
                : (JsonElement?)null;

            // Push current state onto the front of the chain before applying changes
            var snapshot = new
            {
                // Name
                user.FirstName,
                user.LastName,
                user.MiddleName,
                user.DisplayName,

                // Personal
                user.Bio,
                user.DateOfBirth,

                // Media
                user.ProfileImageId,
                user.CoverImageId,

                // Preferences
                user.PreferredLocaleId,
                user.EmailNotificationsEnabled,
                user.SmsNotificationsEnabled,
                user.PushNotificationsEnabled,
                user.MarketingOptIn,
                changedAt = user.UpdatedAt,
                changedBy = user.UpdatedByUserId,
                previous = previousChain,
            };
            user.PreviousState = JsonSerializer.Serialize(snapshot);

            // Name
            if (request.FirstName is not null)
            {
                user.FirstName = request.FirstName;
            }

            if (request.LastName is not null)
            {
                user.LastName = request.LastName;
            }

            if (request.MiddleName is not null)
            {
                user.MiddleName = request.MiddleName;
            }

            if (request.DisplayName is not null)
            {
                user.DisplayName = request.DisplayName;
            }

            // Personal
            if (request.Bio is not null)
            {
                user.Bio = request.Bio;
            }

            if (request.DateOfBirth.HasValue)
            {
                user.DateOfBirth = request.DateOfBirth.Value;
            }

            // Media
            if (request.ProfileImageId is not null)
            {
                user.ProfileImageId = request.ProfileImageId;
            }

            if (request.CoverImageId is not null)
            {
                user.CoverImageId = request.CoverImageId;
            }

            // Preferences
            if (request.PreferredLocaleId.HasValue)
            {
                user.PreferredLocaleId = request.PreferredLocaleId.Value;
            }

            if (request.EmailNotificationsEnabled.HasValue)
            {
                user.EmailNotificationsEnabled = request.EmailNotificationsEnabled.Value;
            }

            if (request.SmsNotificationsEnabled.HasValue)
            {
                user.SmsNotificationsEnabled = request.SmsNotificationsEnabled.Value;
            }

            if (request.PushNotificationsEnabled.HasValue)
            {
                user.PushNotificationsEnabled = request.PushNotificationsEnabled.Value;
            }

            if (request.MarketingOptIn.HasValue)
            {
                user.MarketingOptIn = request.MarketingOptIn.Value;
            }

            user.UpdatedAt = DateTime.UtcNow;
            user.UpdatedByUserId = userManager.GetUserId(principal);

            var result = await userManager.UpdateAsync(user).ConfigureAwait(false);
            return result.Succeeded
                ? Results.NoContent()
                : Results.ValidationProblem(result.Errors
                    .GroupBy(e => e.Code)
                    .ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray()));
        }).RequireAuthorization();

        // DELETE /account/profile — soft-delete the current user's account
        app.MapDelete("/account/profile", async (
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager) =>
        {
            var user = await userManager.GetUserAsync(principal).ConfigureAwait(false);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            if (user.DeletedAt.HasValue)
            {
                return Results.NotFound();
            }

            // Prevent the last SuperAdmin from soft-deleting themselves
            if (await userManager.IsInRoleAsync(user, Roles.SuperAdmin).ConfigureAwait(false))
            {
                var superAdmins = await userManager.GetUsersInRoleAsync(Roles.SuperAdmin).ConfigureAwait(false);
                if (superAdmins.Count == 1)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["account"] =
                        [
                            "Cannot delete the last SuperAdmin account.",
                        ],
                    });
                }
            }

            user.DeletedAt = DateTime.UtcNow;
            user.DeletedByUserId = userManager.GetUserId(principal);

            var result = await userManager.UpdateAsync(user).ConfigureAwait(false);
            if (!result.Succeeded)
            {
                return Results.ValidationProblem(result.Errors
                    .GroupBy(e => e.Code)
                    .ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray()));
            }

            // Rotate the security stamp so any active sessions (cookies / bearer tokens)
            // are invalidated immediately on their next request.
            await userManager.UpdateSecurityStampAsync(user).ConfigureAwait(false);
            return Results.NoContent();
        }).RequireAuthorization();

        // GET /account/{userId}/history — return the audit chain of profile snapshots for a user
        // Self, Admin, and SuperAdmin may access; all others receive 403.
        app.MapGet("/account/{userId}/history", async (
            string userId,
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager) =>
        {
            var requestingUserId = userManager.GetUserId(principal);
            var isSuperAdmin = principal.IsInRole(Roles.SuperAdmin);
            var isAdmin = principal.IsInRole(Roles.Admin);
            var isSupport = principal.IsInRole(Roles.Support);

            if (requestingUserId != userId && !isSuperAdmin && !isAdmin && !isSupport)
            {
                return Results.Forbid();
            }

            var user = await userManager.FindByIdAsync(userId).ConfigureAwait(false);
            if (user is null || user.DeletedAt.HasValue)
            {
                return Results.NotFound();
            }

            if (user.PreviousState is null)
            {
                return Results.Ok(Array.Empty<object>());
            }

            // Walk the nested PreviousState chain and flatten into a list.
            // Each node's "previous" pointer is stripped — the list ordering is the history.
            var entries = new List<JsonObject>();
            try
            {
                var node = JsonNode.Parse(user.PreviousState);

                while (node is JsonObject entry)
                {
                    var next = entry["previous"]?.DeepClone();
                    entry.Remove("previous");
                    entries.Add(entry);
                    node = next;
                }
            }
            catch (JsonException)
            {
                entries.Clear();
            }

            return Results.Ok(entries);
        }).RequireAuthorization();

        return app;
    }
}
