// <copyright file="AccountRecoveryFactory.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Helpers;
using AccountService.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
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
    internal sealed class AccountRecoveryFactory(Action<AccountRecoveryOptions>? configure = null)
        : AccountServiceFactory
    {
        private readonly List<SentMessage> sent = new();

        /// <summary>The kind of message the service handed to the delivery seam.</summary>
        internal enum MessageKind
        {
            /// <summary>An email-confirmation link.</summary>
            ConfirmationLink,

            /// <summary>A password-reset code.</summary>
            PasswordResetCode,

            /// <summary>A password-reset link.</summary>
            PasswordResetLink,
        }

        /// <summary>Gets the messages handed to the delivery seam, in order.</summary>
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

        /// <summary>Gets the confirmation links issued so far, in order.</summary>
        internal IReadOnlyList<SentMessage> ConfirmationLinks =>
            this.Sent.Where(m => m.Kind == MessageKind.ConfirmationLink).ToList();

        /// <summary>Gets the password-reset codes issued so far, in order.</summary>
        internal IReadOnlyList<SentMessage> ResetCodes =>
            this.Sent.Where(m => m.Kind == MessageKind.PasswordResetCode).ToList();

        /// <summary>Gets the password-reset links issued so far, in order.</summary>
        internal IReadOnlyList<SentMessage> ResetLinks =>
            this.Sent.Where(m => m.Kind == MessageKind.PasswordResetLink).ToList();

        /// <inheritdoc/>
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);

            builder.ConfigureServices(services =>
            {
                services.AddScoped<IEmailSender<ApplicationUser>>(sp => new RecordingEmailSender(
                    sp.GetRequiredService<IdentityEmailComposer>(),
                    sp.GetRequiredService<ConfirmationLinkBuilder>(),
                    this.Record));

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

        /// <summary>A message the service handed to the delivery seam.</summary>
        /// <param name="Kind">Which of Identity's three sends this was.</param>
        /// <param name="Email">The address it was issued for.</param>
        /// <param name="Credential">
        /// For a confirmation, the link as the consumer receives it (web origin, configured path).
        /// For a reset, the HTML-decoded code or link.
        /// </param>
        /// <param name="Composed">The message the composer produced.</param>
        internal sealed record SentMessage(MessageKind Kind, string Email, string Credential, OutboundEmail Composed);

        private sealed class RecordingEmailSender(
            IdentityEmailComposer composer,
            ConfirmationLinkBuilder links,
            Action<SentMessage> record) : IEmailSender<ApplicationUser>
        {
            public Task SendConfirmationLinkAsync(ApplicationUser user, string email, string confirmationLink)
            {
                record(new SentMessage(
                    MessageKind.ConfirmationLink,
                    email,
                    links.Rebuild(confirmationLink).ToString(),
                    composer.ConfirmationLink(email, confirmationLink)));
                return Task.CompletedTask;
            }

            public Task SendPasswordResetLinkAsync(ApplicationUser user, string email, string resetLink)
            {
                record(new SentMessage(
                    MessageKind.PasswordResetLink,
                    email,
                    System.Net.WebUtility.HtmlDecode(resetLink),
                    composer.PasswordResetLink(email, resetLink)));
                return Task.CompletedTask;
            }

            public Task SendPasswordResetCodeAsync(ApplicationUser user, string email, string resetCode)
            {
                record(new SentMessage(
                    MessageKind.PasswordResetCode,
                    email,
                    System.Net.WebUtility.HtmlDecode(resetCode),
                    composer.PasswordResetCode(email, resetCode)));
                return Task.CompletedTask;
            }
        }
    }
}
