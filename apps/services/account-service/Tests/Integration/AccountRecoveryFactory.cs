// <copyright file="AccountRecoveryFactory.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text.Encodings.Web;
using AccountService.Configuration;
using AccountService.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// A factory for account-recovery tests: it captures the confirmation links and reset codes the
    /// service issues, and lets each test dictate the recovery policy it needs.
    /// </summary>
    /// <remarks>
    /// Deliberately <em>not</em> an <c>IClassFixture</c>. The rate limiter counts per client address,
    /// and every request from <c>TestServer</c> arrives with no remote address at all, so a shared
    /// host would let one test's requests exhaust another test's budget. One host per test keeps the
    /// counters — like the in-memory database — private to the test that owns them.
    /// </remarks>
    /// <param name="configure">Recovery policy overrides for this host, if any.</param>
    internal sealed class AccountRecoveryFactory(Action<AccountRecoveryOptions>? configure = null)
        : AccountServiceFactory
    {
        private readonly List<SentMessage> sent = new();

        /// <summary>The kind of message the service handed to the delivery channel.</summary>
        internal enum MessageKind
        {
            /// <summary>An email-confirmation link.</summary>
            ConfirmationLink,

            /// <summary>A password-reset code.</summary>
            PasswordResetCode,

            /// <summary>A password-reset link.</summary>
            PasswordResetLink,
        }

        /// <summary>Gets the messages handed to the delivery channel, in order.</summary>
        internal IReadOnlyList<SentMessage> Sent
        {
            get
            {
                lock (this.sent)
                {
                    return this.sent.ToList();
                }
            }
        }

        /// <summary>Gets the password-reset codes issued so far, in order.</summary>
        internal IReadOnlyList<SentMessage> ResetCodes =>
            this.Sent.Where(m => m.Kind == MessageKind.PasswordResetCode).ToList();

        /// <summary>Gets the confirmation links issued so far, in order.</summary>
        internal IReadOnlyList<SentMessage> ConfirmationLinks =>
            this.Sent.Where(m => m.Kind == MessageKind.ConfirmationLink).ToList();

        /// <inheritdoc/>
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);

            builder.ConfigureServices(services =>
            {
                // Stands in for the delivery channel so a test can read what the account holder
                // would have received. Registered last, so it wins over the service's own sender —
                // which itself only exists to stop Identity's DefaultMessageEmailSender ->
                // NoOpEmailSender chain discarding everything silently.
                services.AddScoped<IEmailSender<ApplicationUser>>(_ => new RecordingEmailSender(this.Record));

                if (configure is not null)
                {
                    services.Configure(configure);
                }
            });
        }

        private void Record(SentMessage message)
        {
            lock (this.sent)
            {
                this.sent.Add(message);
            }
        }

        /// <summary>A message the service handed to the delivery channel.</summary>
        /// <param name="Kind">Which of Identity's three sends this was.</param>
        /// <param name="Email">The address it was issued for.</param>
        /// <param name="Credential">
        /// The link or code, HTML-decoded. Identity passes both through
        /// <see cref="HtmlEncoder"/> on the way to the sender, which turns the <c>&amp;</c>
        /// separating a confirmation link's query parameters into <c>&amp;amp;</c>. Decoding here
        /// means a test can use the value as the consumer's browser would rather than rediscovering
        /// that each time.
        /// </param>
        internal sealed record SentMessage(MessageKind Kind, string Email, string Credential);

        private sealed class RecordingEmailSender(Action<SentMessage> record) : IEmailSender<ApplicationUser>
        {
            public Task SendConfirmationLinkAsync(ApplicationUser user, string email, string confirmationLink) =>
                this.Capture(MessageKind.ConfirmationLink, email, confirmationLink);

            public Task SendPasswordResetLinkAsync(ApplicationUser user, string email, string resetLink) =>
                this.Capture(MessageKind.PasswordResetLink, email, resetLink);

            public Task SendPasswordResetCodeAsync(ApplicationUser user, string email, string resetCode) =>
                this.Capture(MessageKind.PasswordResetCode, email, resetCode);

            private Task Capture(MessageKind kind, string email, string credential)
            {
                record(new SentMessage(kind, email, System.Net.WebUtility.HtmlDecode(credential)));
                return Task.CompletedTask;
            }
        }
    }
}
