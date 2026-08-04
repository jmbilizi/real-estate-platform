// <copyright file="UpdateProfileRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>
/// Request body for updating a user's profile fields.
/// All fields are optional — only non-null values are applied.
/// </summary>
internal sealed class UpdateProfileRequest
{
    // Name

    /// <summary>Gets or sets the user's first name.</summary>
    public string? FirstName { get; set; }

    /// <summary>Gets or sets the user's last name.</summary>
    public string? LastName { get; set; }

    /// <summary>Gets or sets the user's middle name.</summary>
    public string? MiddleName { get; set; }

    /// <summary>Gets or sets the display name shown on public profiles and listings.</summary>
    public string? DisplayName { get; set; }

    // Personal

    /// <summary>Gets or sets a short bio shown on the user's public profile.</summary>
    public string? Bio { get; set; }

    /// <summary>Gets or sets the user's date of birth. Must not be in the future or more than 150 years ago.</summary>
    public DateOnly? DateOfBirth { get; set; }

    // Media

    /// <summary>Gets or sets the ID of the user's profile image.</summary>
    public string? ProfileImageId { get; set; }

    /// <summary>Gets or sets the ID of the user's cover image.</summary>
    public string? CoverImageId { get; set; }

    // Preferences

    /// <summary>Gets or sets the ID of the user's preferred locale. Must reference an existing locale.</summary>
    public int? PreferredLocaleId { get; set; }

    /// <summary>Gets or sets a value indicating whether the user wants email notifications.</summary>
    public bool? EmailNotificationsEnabled { get; set; }

    /// <summary>Gets or sets a value indicating whether the user wants SMS notifications.</summary>
    public bool? SmsNotificationsEnabled { get; set; }

    /// <summary>Gets or sets a value indicating whether the user wants push notifications.</summary>
    public bool? PushNotificationsEnabled { get; set; }

    /// <summary>Gets or sets a value indicating whether the user has opted in to marketing communications.</summary>
    public bool? MarketingOptIn { get; set; }

    // Onboarding

    /// <summary>
    /// Gets or sets the user's self-declared onboarding intents (see
    /// <see cref="Models.OnboardingIntents"/> for the fixed vocabulary). When
    /// provided, replaces the entire current set (not additive) — matching "changeable at any
    /// time" (PRD §4.4). Null means no change; an explicit empty list clears all intents.
    /// </summary>
    public List<string>? Intents { get; set; }
}
