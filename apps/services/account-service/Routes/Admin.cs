// <copyright file="Admin.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using AccountService.Dtos;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Routes;

internal static class Admin
{
    // Roles that Admin (non-SuperAdmin) is permitted to assign or remove.
    // SuperAdmin and Admin role changes are restricted to SuperAdmin only.
    // OrdinalIgnoreCase so callers are not blocked by casing differences (e.g. "moderator" == "Moderator").
    private static readonly HashSet<string> AdminAssignableRoles =
        new(StringComparer.OrdinalIgnoreCase)
        {
            Roles.Moderator,
            Roles.Support,
            Roles.Developer,
            Roles.User,
        };

    private static readonly string[] CannotRemoveOwnSuperAdminError = new[] { "Cannot remove your own SuperAdmin role." };

    internal static IEndpointRouteBuilder MapAdminRoutes(this IEndpointRouteBuilder app)
    {
        // GET /account/{userId}/roles — read roles for a user (self, Admin, or SuperAdmin)
        app.MapGet("/account/{userId}/roles", async (
            string userId,
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager) =>
        {
            var requestingUserId = userManager.GetUserId(principal);
            var isSuperAdmin = principal.IsInRole(Roles.SuperAdmin);
            var isAdmin = principal.IsInRole(Roles.Admin);

            if (requestingUserId != userId && !isSuperAdmin && !isAdmin)
            {
                return Results.Forbid();
            }

            var user = await userManager.FindByIdAsync(userId).ConfigureAwait(false);
            if (user is null || user.DeletedAt.HasValue)
            {
                return Results.NotFound();
            }

            var roles = await userManager.GetRolesAsync(user).ConfigureAwait(false);
            return Results.Ok(roles);
        }).RequireAuthorization();

        // POST /account/{userId}/roles — assign a role (Admin or SuperAdmin only)
        // SuperAdmin can assign any role; Admin can only assign Moderator, Developer, User.
        app.MapPost("/account/{userId}/roles", async (
            string userId,
            AssignRoleRequest request,
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager,
            RoleManager<IdentityRole> roleManager) =>
        {
            var isSuperAdmin = principal.IsInRole(Roles.SuperAdmin);
            var isAdmin = principal.IsInRole(Roles.Admin);

            if (!isSuperAdmin && !isAdmin)
            {
                return Results.Forbid();
            }

            // Admin cannot assign privileged roles
            if (!isSuperAdmin && !AdminAssignableRoles.Contains(request.Role))
            {
                return Results.Forbid();
            }

            if (!await roleManager.RoleExistsAsync(request.Role).ConfigureAwait(false))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["role"] = new[] { $"'{request.Role}' is not a recognised role." },
                });
            }

            var user = await userManager.FindByIdAsync(userId).ConfigureAwait(false);
            if (user is null || user.DeletedAt.HasValue)
            {
                return Results.NotFound();
            }

            // Idempotent — if the user already has the role treat it as success
            if (await userManager.IsInRoleAsync(user, request.Role).ConfigureAwait(false))
            {
                return Results.NoContent();
            }

            var result = await userManager.AddToRoleAsync(user, request.Role).ConfigureAwait(false);
            return result.Succeeded
                ? Results.NoContent()
                : Results.ValidationProblem(result.Errors
                    .GroupBy(e => e.Code)
                    .ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray()));
        }).RequireAuthorization();

        // DELETE /account/{userId}/roles/{role} — remove a role (Admin or SuperAdmin only)
        // SuperAdmin cannot remove their own SuperAdmin role (safety guard).
        app.MapDelete("/account/{userId}/roles/{role}", async (
            string userId,
            string role,
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager) =>
        {
            var requestingUserId = userManager.GetUserId(principal);
            var isSuperAdmin = principal.IsInRole(Roles.SuperAdmin);
            var isAdmin = principal.IsInRole(Roles.Admin);

            if (!isSuperAdmin && !isAdmin)
            {
                return Results.Forbid();
            }

            // Admin cannot remove privileged roles
            if (!isSuperAdmin && !AdminAssignableRoles.Contains(role))
            {
                return Results.Forbid();
            }

            // Prevent a SuperAdmin from locking themselves out
            if (requestingUserId == userId && role == Roles.SuperAdmin)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["role"] = CannotRemoveOwnSuperAdminError,
                });
            }

            var user = await userManager.FindByIdAsync(userId).ConfigureAwait(false);
            if (user is null || user.DeletedAt.HasValue)
            {
                return Results.NotFound();
            }

            var result = await userManager.RemoveFromRoleAsync(user, role).ConfigureAwait(false);
            return result.Succeeded
                ? Results.NoContent()
                : Results.ValidationProblem(result.Errors
                    .GroupBy(e => e.Code)
                    .ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray()));
        }).RequireAuthorization();

        return app;
    }
}
