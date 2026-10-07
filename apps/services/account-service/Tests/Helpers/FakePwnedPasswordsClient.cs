// <copyright file="FakePwnedPasswordsClient.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Helpers;

namespace AccountService.Tests.Helpers
{
    /// <summary>A breach client for tests. It never reaches the network.</summary>
    internal sealed class FakePwnedPasswordsClient : IPwnedPasswordsClient
    {
        private readonly HashSet<string> breached = new(StringComparer.Ordinal);

        /// <summary>Gets or sets a value indicating whether the check fails to answer, as on a timeout.</summary>
        public bool Unavailable { get; set; }

        /// <summary>Gets the number of checks made.</summary>
        public int Calls { get; private set; }

        /// <summary>Marks a password as breached.</summary>
        /// <param name="password">The password.</param>
        public void Breach(string password) => this.breached.Add(password);

        /// <inheritdoc/>
        public Task<bool?> IsBreachedAsync(string password, CancellationToken cancellationToken = default)
        {
            this.Calls++;
            return Task.FromResult<bool?>(this.Unavailable ? null : this.breached.Contains(password));
        }
    }
}
