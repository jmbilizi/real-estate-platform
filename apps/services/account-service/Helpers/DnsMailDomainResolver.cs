// <copyright file="DnsMailDomainResolver.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Globalization;
using AccountService.Configuration;
using DnsClient;
using DnsClient.Protocol;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Looks up MX, then A and AAAA, for the domain of an address. Any timeout or error returns
/// <see cref="MailDomainStatus.Unknown"/>, so a DNS fault never blocks a sign-up. The resolver does
/// not block disposable domains. It never logs the domain, because the domain is part of the address.
/// </summary>
internal sealed class DnsMailDomainResolver : IMailDomainResolver
{
    private readonly ILookupClient client;
    private readonly EmailDeliverabilityOptions settings;

    /// <summary>Initializes a new instance of the <see cref="DnsMailDomainResolver"/> class.</summary>
    /// <param name="options">The deliverability options.</param>
    public DnsMailDomainResolver(IOptions<EmailDeliverabilityOptions> options)
        : this(options, null)
    {
    }

    /// <summary>Initializes a new instance of the <see cref="DnsMailDomainResolver"/> class.</summary>
    /// <param name="options">The deliverability options.</param>
    /// <param name="client">A lookup client. A test supplies one that points at a chosen name server.</param>
    internal DnsMailDomainResolver(IOptions<EmailDeliverabilityOptions> options, ILookupClient? client)
    {
        this.settings = options.Value;
        this.client = client ?? new LookupClient(new LookupClientOptions
        {
            Timeout = this.settings.DnsTimeout,
            Retries = 1,
            UseCache = true,
            ThrowDnsErrors = false,
        });
    }

    /// <inheritdoc/>
    public async Task<MailDomainStatus> ResolveAsync(string domain, CancellationToken cancellationToken = default)
    {
        if (!this.settings.MxCheckEnabled)
        {
            return MailDomainStatus.Unknown;
        }

        string ascii;
        try
        {
            ascii = new IdnMapping().GetAscii(domain.Trim().TrimEnd('.'));
        }
        catch (ArgumentException)
        {
            return MailDomainStatus.Unknown;
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(this.settings.DnsTimeout);
        try
        {
            return await this.LookupAsync(ascii, timeout.Token).ConfigureAwait(false);
        }
#pragma warning disable CA1031 // Fail open on every DNS fault: no failure may block a sign-up.
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
        {
            // Fail open on every DNS fault, including the timeout above. A caller cancel still throws.
            return MailDomainStatus.Unknown;
        }
#pragma warning restore CA1031
    }

    private async Task<MailDomainStatus> LookupAsync(string domain, CancellationToken cancellationToken)
    {
        var mx = await this.client.QueryAsync(domain, QueryType.MX, cancellationToken: cancellationToken).ConfigureAwait(false);
        if (mx.Header.ResponseCode == DnsHeaderResponseCode.NotExistentDomain)
        {
            return MailDomainStatus.CannotReceiveMail;
        }

        if (mx.HasError)
        {
            return MailDomainStatus.Unknown;
        }

        var records = mx.Answers.MxRecords().ToList();
        if (records.Count > 0)
        {
            // RFC 7505: a lone null MX (".") says the domain accepts no mail.
            return records.All(r => string.IsNullOrEmpty(r.Exchange.Value) || r.Exchange.Value == ".")
                ? MailDomainStatus.CannotReceiveMail
                : MailDomainStatus.CanReceiveMail;
        }

        foreach (var type in new[] { QueryType.A, QueryType.AAAA })
        {
            var address = await this.client.QueryAsync(domain, type, cancellationToken: cancellationToken).ConfigureAwait(false);
            if (address.HasError)
            {
                return MailDomainStatus.Unknown;
            }

            if (address.Answers.Any(a => a is ARecord or AaaaRecord))
            {
                return MailDomainStatus.CanReceiveMail;
            }
        }

        return MailDomainStatus.CannotReceiveMail;
    }
}
