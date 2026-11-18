// <copyright file="GoogleIdentity.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The claims of a Google ID token that passed signature, issuer, audience and expiry checks.</summary>
/// <param name="Subject">The stable Google account ID (<c>sub</c>).</param>
/// <param name="Email">The address on the Google account.</param>
/// <param name="EmailVerified">The <c>email_verified</c> claim.</param>
internal sealed record GoogleIdentity(string Subject, string Email, bool EmailVerified);
