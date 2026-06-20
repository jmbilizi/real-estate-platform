// <copyright file="Roles.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// Platform role name constants. Use these instead of magic strings when checking
/// or assigning roles to avoid silent typo bugs.
/// </summary>
internal static class Roles
{
    /// <summary>Full platform access including role management and billing.</summary>
    public const string SuperAdmin = "SuperAdmin";

    /// <summary>Manages users, content, and platform configuration. Cannot manage SuperAdmin or Admin roles.</summary>
    public const string Admin = "Admin";

    /// <summary>Reviews and moderates platform content; can suspend users. No role management access.</summary>
    public const string Moderator = "Moderator";

    /// <summary>Handles user account issues and disputes. Read-only access to user data.</summary>
    public const string Support = "Support";

    /// <summary>Internal engineering access for diagnostics and tooling.</summary>
    public const string Developer = "Developer";

    /// <summary>Standard platform user. Assigned automatically on registration.</summary>
    public const string User = "User";
}
