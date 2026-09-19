// <copyright file="ConfirmationLinkBuilder.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using AccountService.Configuration;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Builds the confirmation link a consumer clicks: the configured web origin plus the configured
/// confirmation path, carrying Identity's <c>userId</c> and <c>code</c>.
/// </summary>
/// <remarks>
/// Identity builds its link with <c>LinkGenerator.GetUriByName</c> from the inbound request's
/// scheme and host. Behind Ocelot that is <c>http://account-service-svc:8080</c>, an in-cluster
/// name a browser cannot resolve. This class replaces the origin and path and keeps the query, so
/// the link points at the web app (#148 owns the route) and no host is hard-coded (PRD §1).
/// </remarks>
/// <param name="options">The account-recovery options.</param>
internal sealed class ConfirmationLinkBuilder(IOptions<AccountRecoveryOptions> options)
{
    /// <summary>Builds a confirmation link for the given identity token values.</summary>
    /// <param name="userId">Identity's user id.</param>
    /// <param name="code">The Base64Url-encoded confirmation code.</param>
    /// <param name="changedEmail">The new address, for the email-change flow only.</param>
    /// <returns>The absolute link.</returns>
    internal Uri Build(string userId, string code, string? changedEmail = null)
    {
        var settings = options.Value;
        var origin = settings.WebBaseUrl ?? throw new InvalidOperationException(
            $"{AccountRecoveryOptions.SectionName}:{nameof(settings.WebBaseUrl)} is not configured.");

        var query = new Dictionary<string, string?>
        {
            ["userId"] = userId,
            ["code"] = code,
        };

        if (!string.IsNullOrEmpty(changedEmail))
        {
            query["changedEmail"] = changedEmail;
        }

        var target = new Uri(origin, settings.ConfirmationPath);
        return new Uri(QueryHelpers.AddQueryString(target.GetLeftPart(UriPartial.Path), query));
    }

    /// <summary>
    /// Rebuilds the link Identity handed to the email sender onto the configured web origin.
    /// </summary>
    /// <param name="identityLink">
    /// The link from <c>IEmailSender.SendConfirmationLinkAsync</c>. Identity HTML-encodes it.
    /// </param>
    /// <returns>The absolute link.</returns>
    internal Uri Rebuild(string identityLink)
    {
        var decoded = new Uri(WebUtility.HtmlDecode(identityLink));
        var query = QueryHelpers.ParseQuery(decoded.Query);

        if (!query.TryGetValue("userId", out var userId) || !query.TryGetValue("code", out var code))
        {
            throw new InvalidOperationException("Identity's confirmation link carries no userId and code.");
        }

        query.TryGetValue("changedEmail", out var changedEmail);
        return this.Build(userId.ToString(), code.ToString(), changedEmail.ToString());
    }
}
