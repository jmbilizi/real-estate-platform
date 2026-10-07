// <copyright file="IMailDomainResolver.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>What a DNS lookup says about the domain of an address.</summary>
internal enum MailDomainStatus
{
    /// <summary>The lookup could not finish. The caller treats the domain as fine.</summary>
    Unknown,

    /// <summary>The domain has an MX record, or an A or AAAA record to fall back on.</summary>
    CanReceiveMail,

    /// <summary>The domain does not exist, has a null MX, or has no MX, A or AAAA record.</summary>
    CannotReceiveMail,
}

/// <summary>Checks whether the domain of an address can receive mail.</summary>
internal interface IMailDomainResolver
{
    /// <summary>Looks up one domain. It never throws for a DNS failure.</summary>
    /// <param name="domain">The domain part of the address.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The status. <see cref="MailDomainStatus.Unknown"/> on a timeout or an error.</returns>
    Task<MailDomainStatus> ResolveAsync(string domain, CancellationToken cancellationToken = default);
}
