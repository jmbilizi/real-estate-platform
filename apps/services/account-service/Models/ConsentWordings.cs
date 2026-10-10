// <copyright file="ConsentWordings.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// The consent wordings the server holds (#694). The client sends only an id. The consent record
/// stores the id and the version, so the text shown is always known and no free text is stored.
/// A change of text needs a new version. Keep every old text in the repo history.
/// </summary>
internal static class ConsentWordings
{
    /// <summary>The id of the wording for non-transactional email.</summary>
    public const string EmailNonTransactional = "email_non_transactional";

    /// <summary>The current version of the email wording.</summary>
    public const int EmailNonTransactionalVersion = 1;

    /// <summary>The current text of the email wording. The web app shows this text next to the toggle.</summary>
    public const string EmailNonTransactionalText =
        "Send me Cribstop updates and alerts by email. I can turn this off at any time. Cribstop is brokered by Real Broker, LLC.";

    /// <summary>Finds the current version of a wording.</summary>
    /// <param name="id">The wording id.</param>
    /// <param name="version">The current version.</param>
    /// <returns><see langword="true"/> when the id is known.</returns>
    public static bool TryGetVersion(string? id, out int version)
    {
        version = EmailNonTransactionalVersion;
        return id == EmailNonTransactional;
    }
}
