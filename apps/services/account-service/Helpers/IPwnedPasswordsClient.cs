// <copyright file="IPwnedPasswordsClient.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>Asks the Pwned Passwords range API whether a password is in a known breach.</summary>
internal interface IPwnedPasswordsClient
{
    /// <summary>Checks one password. Only the first five characters of its SHA-1 leave the process.</summary>
    /// <param name="password">The password.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns><see langword="true"/> for a breached password, <see langword="false"/> for a clean one, <see langword="null"/> when the check could not finish.</returns>
    Task<bool?> IsBreachedAsync(string password, CancellationToken cancellationToken = default);
}
