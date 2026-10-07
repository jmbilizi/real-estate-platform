// <copyright file="RoleGrantAudit.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// One append-only record of a role grant or removal: who changed whose role, which role, and when.
/// </summary>
internal sealed class RoleGrantAudit
{
    /// <summary>The <see cref="Action"/> value for a role grant.</summary>
    public const string Granted = "Granted";

    /// <summary>The <see cref="Action"/> value for a role removal.</summary>
    public const string Removed = "Removed";

    /// <summary>Gets or sets the record id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the account id of the admin who made the change.</summary>
    public string GrantorUserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the account id whose role changed.</summary>
    public string GranteeUserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the role name.</summary>
    public string Role { get; set; } = string.Empty;

    /// <summary>Gets or sets <see cref="Granted"/> or <see cref="Removed"/>.</summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>Gets or sets the UTC time of the change.</summary>
    public DateTime OccurredAt { get; set; }
}
