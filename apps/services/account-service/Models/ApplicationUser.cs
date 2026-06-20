// <copyright file="ApplicationUser.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.AspNetCore.Identity;

namespace AccountService.Models;

/// <summary>
/// Extended Identity user with profile fields and audit trail.
/// </summary>
internal class ApplicationUser : IdentityUser
{
    // Name

    /// <summary>Gets or sets the user's first name.</summary>
    public string FirstName { get; set; } = string.Empty;

    /// <summary>Gets or sets the user's last name.</summary>
    public string LastName { get; set; } = string.Empty;

    /// <summary>Gets or sets the user's middle name.</summary>
    public string MiddleName { get; set; } = string.Empty;

    /// <summary>Gets or sets the display name shown on public profiles and listings. Falls back to Email if null.</summary>
    public string? DisplayName { get; set; }

    // Personal

    /// <summary>Gets or sets the user's short bio shown on their public profile.</summary>
    public string? Bio { get; set; }

    /// <summary>Gets or sets the user's date of birth. Null when not provided.</summary>
    public DateOnly? DateOfBirth { get; set; }

    // Media

    /// <summary>Gets or sets the ID of the user's profile image (references a future media table).</summary>
    public string? ProfileImageId { get; set; }

    /// <summary>Gets or sets the ID of the user's cover image (references a future media table).</summary>
    public string? CoverImageId { get; set; }

    // Core identity

    /// <summary>Gets or sets the UTC timestamp when this account was verified. Null means unverified.</summary>
    public DateTime? VerifiedAt { get; set; }

    /// <summary>Gets or sets the ID of the user (admin/system) who verified this account.</summary>
    public string? VerifiedByUserId { get; set; }

    /// <summary>Gets or sets a note describing what was verified (e.g. "Government ID", "Agent licence #12345"). Null when unverified.</summary>
    public string? VerificationNote { get; set; }

    /// <summary>Gets or sets the ID of the user's account status. References the AccountStatuses lookup table.</summary>
    public int? AccountStatusId { get; set; }

    /// <summary>Gets or sets the UTC timestamp of the user's most recent login. Updated by authentication middleware.</summary>
    public DateTime? LastLoginAt { get; set; }

    // Preferences

    /// <summary>Gets or sets the ID of the user's preferred locale. References the Locales lookup table.</summary>
    public int? PreferredLocaleId { get; set; }

    /// <summary>Gets or sets a value indicating whether the user wants email notifications.</summary>
    public bool EmailNotificationsEnabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether the user wants SMS notifications.</summary>
    public bool SmsNotificationsEnabled { get; set; }

    /// <summary>Gets or sets a value indicating whether the user wants push notifications.</summary>
    public bool PushNotificationsEnabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether the user has opted in to marketing communications.</summary>
    public bool MarketingOptIn { get; set; }

    // Audit

    /// <summary>Gets or sets the UTC timestamp when this record was created.</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>Gets or sets the UTC timestamp of the most recent update to this record.</summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>Gets or sets the ID of the user who created this record.</summary>
    public string? CreatedByUserId { get; set; }

    /// <summary>Gets or sets the ID of the user who last updated this record.</summary>
    public string? UpdatedByUserId { get; set; }

    /// <summary>Gets or sets the UTC timestamp when this record was soft-deleted. Null means the record is active.</summary>
    public DateTime? DeletedAt { get; set; }

    /// <summary>Gets or sets the ID of the user who soft-deleted this record.</summary>
    public string? DeletedByUserId { get; set; }

    /// <summary>
    /// Gets or sets the JSON-serialized snapshot of this record's previous state, including a
    /// pointer to the state before that. Traversing the nested "previous" chain reveals the
    /// full audit history of the row. Null on first save.
    /// </summary>
    public string? PreviousState { get; set; }

    // Navigation properties

    /// <summary>Gets or sets the user's account status.</summary>
    public AccountStatus? AccountStatus { get; set; }

    /// <summary>Gets or sets the user's preferred locale.</summary>
    public Locale? PreferredLocale { get; set; }

    /// <summary>Gets or sets the user who verified this account.</summary>
    public ApplicationUser? VerifiedByUser { get; set; }

    /// <summary>Gets or sets the user who created this record.</summary>
    public ApplicationUser? CreatedByUser { get; set; }

    /// <summary>Gets or sets the user who last updated this record.</summary>
    public ApplicationUser? UpdatedByUser { get; set; }

    /// <summary>Gets or sets the user who soft-deleted this record.</summary>
    public ApplicationUser? DeletedByUser { get; set; }

    /// <summary>Gets or sets the collection of API keys belonging to this user.</summary>
    public ICollection<ApiKey> ApiKeys { get; set; } = new List<ApiKey>();

    /// <summary>Gets or sets the apps this user has authenticated with.</summary>
    public ICollection<UserApp> UserApps { get; set; } = new List<UserApp>();
}
