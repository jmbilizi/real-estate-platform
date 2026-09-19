// <copyright file="RegisterWaitlistInterestRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>
/// Body of <c>POST /account/waitlist</c>. The interest kind is the entire payload — the endpoint
/// collects no protected-class or eligibility signal (PRD §6).
/// </summary>
internal sealed class RegisterWaitlistInterestRequest
{
    /// <summary>Gets or sets the interest kind to register.</summary>
    public string? Interest { get; set; }
}
