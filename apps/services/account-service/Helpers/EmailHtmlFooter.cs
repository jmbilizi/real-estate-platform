// <copyright file="EmailHtmlFooter.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The footer facts the template shows on every email.</summary>
/// <param name="BrokerageDisclosure">The configured brokerage line (PRD §6).</param>
/// <param name="ReplyToAddress">The monitored contact address.</param>
/// <param name="PrivacyUrl">The Privacy Policy page, or null when the web origin is not configured.</param>
/// <param name="TermsUrl">The Terms page, or null when the web origin is not configured.</param>
internal sealed record EmailHtmlFooter(
    string BrokerageDisclosure,
    string ReplyToAddress,
    Uri? PrivacyUrl,
    Uri? TermsUrl);
