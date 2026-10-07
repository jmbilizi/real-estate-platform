// <copyright file="AccountRecoveryFactory.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Helpers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// A factory for the Identity-surface tests. It records every message the service hands to the
    /// delivery seam, composed through the real <see cref="IdentityEmailComposer"/>, and lets each
    /// test set the recovery policy it needs.
    /// </summary>
    /// <remarks>
    /// Not an <c>IClassFixture</c>. The rate limiter counts per client address and TestServer
    /// requests carry none, so one host per test keeps the counters private to the test.
    /// </remarks>
    /// <param name="configure">Recovery policy overrides for this host, if any.</param>
    /// <param name="configureCodes">Email code policy overrides, applied after the host sets its key.</param>
    /// <param name="clock">A clock for the host, if the test moves time.</param>
    internal sealed class AccountRecoveryFactory(
        Action<AccountRecoveryOptions>? configure = null,
        Action<EmailCodeOptions>? configureCodes = null,
        TimeProvider? clock = null)
        : AccountServiceFactory
    {
        private readonly List<OutboundEmail> alreadyRegistered = new();

        /// <summary>Gets the already-registered notices issued so far, in order.</summary>
        internal IReadOnlyList<OutboundEmail> AlreadyRegisteredNotices
        {
            get
            {
                lock (this.alreadyRegistered)
                {
                    return this.alreadyRegistered.ToList();
                }
            }
        }

        /// <inheritdoc/>
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);

            builder.ConfigureServices(services =>
            {
                // Fake only the transport boundary so the real composer runs.
                services.AddSingleton<IOutboundEmailSender>(new RecordingOutboundEmailSender(this.RecordAlreadyRegistered));

                if (configure is not null)
                {
                    services.Configure(configure);
                }

                if (configureCodes is not null)
                {
                    // PostConfigure runs after Program's own, which sets the key.
                    services.PostConfigure(configureCodes);
                }

                if (clock is not null)
                {
                    services.AddSingleton(clock);
                }
            });
        }

        private void RecordAlreadyRegistered(OutboundEmail message)
        {
            lock (this.alreadyRegistered)
            {
                this.alreadyRegistered.Add(message);
            }
        }

        private sealed class RecordingOutboundEmailSender(Action<OutboundEmail> record) : IOutboundEmailSender
        {
            public Task SendAsync(OutboundEmail message, CancellationToken cancellationToken = default)
            {
                record(message);
                return Task.CompletedTask;
            }
        }
    }
}
