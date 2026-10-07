// <copyright file="DnsMailDomainResolverTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Net;
using AccountService.Configuration;
using AccountService.Helpers;
using DnsClient;
using FluentAssertions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Tests for <see cref="DnsMailDomainResolver"/>. No test reaches a real name server: the lookup
    /// client points at a loopback port with no listener, which is how a dead resolver looks.
    /// </summary>
    public class DnsMailDomainResolverTests
    {
        [Fact]
        public async Task ResolveAsync_WhenTheNameServerDoesNotAnswer_FailsOpenWithinTheTimeout()
        {
            var settings = new EmailDeliverabilityOptions { DnsTimeout = TimeSpan.FromMilliseconds(500) };
            var client = new LookupClient(new LookupClientOptions(new IPEndPoint(IPAddress.Loopback, 1))
            {
                Timeout = TimeSpan.FromMilliseconds(200),
                Retries = 0,
                UseCache = false,
                ThrowDnsErrors = true,
            });
            var resolver = new DnsMailDomainResolver(Options.Create(settings), client);
            var clock = Stopwatch.StartNew();

            var status = await resolver.ResolveAsync("example.com");

            status.Should().Be(MailDomainStatus.Unknown);
            clock.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(5));
        }

        [Fact]
        public async Task ResolveAsync_WhenTheCheckIsOff_ReturnsUnknownWithoutALookup()
        {
            var resolver = new DnsMailDomainResolver(
                Options.Create(new EmailDeliverabilityOptions { MxCheckEnabled = false }),
                ThrowingLookupClient());

            (await resolver.ResolveAsync("example.com")).Should().Be(MailDomainStatus.Unknown);
        }

        [Fact]
        public async Task ResolveAsync_ForAnInvalidDomain_FailsOpen()
        {
            var resolver = new DnsMailDomainResolver(
                Options.Create(new EmailDeliverabilityOptions()),
                ThrowingLookupClient());

            (await resolver.ResolveAsync(new string('a', 300) + ".example")).Should().Be(MailDomainStatus.Unknown);
        }

        [Fact]
        public void Validate_RejectsANonPositiveTimeout()
        {
            new EmailDeliverabilityOptions { DnsTimeout = TimeSpan.Zero }.Validate().Should().NotBeNull();
            new EmailDeliverabilityOptions().Validate().Should().BeNull();
        }

        private static ILookupClient ThrowingLookupClient()
        {
            var mock = new Mock<ILookupClient>();
            mock.Setup(c => c.QueryAsync(It.IsAny<string>(), It.IsAny<QueryType>(), It.IsAny<QueryClass>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new InvalidOperationException("The lookup must not run."));
            return mock.Object;
        }
    }
}
