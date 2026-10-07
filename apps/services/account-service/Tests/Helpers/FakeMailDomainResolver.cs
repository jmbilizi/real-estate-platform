// <copyright file="FakeMailDomainResolver.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Collections.Concurrent;
using AccountService.Helpers;

namespace AccountService.Tests.Helpers
{
    /// <summary>An MX resolver for tests. It never reaches the network.</summary>
    internal sealed class FakeMailDomainResolver : IMailDomainResolver
    {
        private readonly ConcurrentDictionary<string, MailDomainStatus> answers = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>Gets or sets the status for a domain with no set answer.</summary>
        public MailDomainStatus Default { get; set; } = MailDomainStatus.CanReceiveMail;

        /// <summary>Sets the answer for one domain.</summary>
        /// <param name="domain">The domain.</param>
        /// <param name="status">The status.</param>
        public void Set(string domain, MailDomainStatus status) => this.answers[domain] = status;

        /// <inheritdoc/>
        public Task<MailDomainStatus> ResolveAsync(string domain, CancellationToken cancellationToken = default) =>
            Task.FromResult(this.answers.TryGetValue(domain, out var status) ? status : this.Default);
    }
}
