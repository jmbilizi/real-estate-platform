// <copyright file="PasswordResetFactory.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Helpers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// A factory for password-reset tests: it captures the tokens the service issues, and lets each
    /// test dictate the reset policy it needs.
    /// </summary>
    /// <remarks>
    /// Deliberately <em>not</em> an <c>IClassFixture</c>. The rate limiter counts per client address,
    /// and every request from <c>TestServer</c> arrives with no remote address at all, so a shared
    /// host would let one test's requests exhaust another test's budget. One host per test keeps the
    /// counters — like the in-memory database — private to the test that owns them.
    /// </remarks>
    /// <param name="configure">Reset policy overrides for this host, if any.</param>
    internal sealed class PasswordResetFactory(Action<PasswordResetOptions>? configure = null)
        : AccountServiceFactory
    {
        private readonly List<IssuedToken> issued = new();

        /// <summary>Gets the tokens handed to the delivery channel, in order.</summary>
        internal IReadOnlyList<IssuedToken> Issued
        {
            get
            {
                lock (this.issued)
                {
                    return this.issued.ToList();
                }
            }
        }

        /// <inheritdoc/>
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);

            builder.ConfigureServices(services =>
            {
                // Stands in for the delivery channel so a test can read the code the account holder
                // would have received. Registered last, so it wins over the service's own notifier.
                services.AddScoped<IPasswordResetNotifier>(_ => new RecordingNotifier(this.Record));

                if (configure is not null)
                {
                    services.Configure(configure);
                }
            });
        }

        private void Record(IssuedToken token)
        {
            lock (this.issued)
            {
                this.issued.Add(token);
            }
        }

        /// <summary>A token the service handed to the delivery channel.</summary>
        /// <param name="Email">The address it was issued for.</param>
        /// <param name="ResetCode">The URL-safe reset code.</param>
        internal sealed record IssuedToken(string Email, string ResetCode);

        private sealed class RecordingNotifier(Action<IssuedToken> record) : IPasswordResetNotifier
        {
            public Task SendPasswordResetAsync(string email, string resetCode, CancellationToken cancellationToken)
            {
                record(new IssuedToken(email, resetCode));
                return Task.CompletedTask;
            }
        }
    }
}
