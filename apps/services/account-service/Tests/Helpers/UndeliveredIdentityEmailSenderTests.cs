// <copyright file="UndeliveredIdentityEmailSenderTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Tests for the stand-in <c>IEmailSender&lt;ApplicationUser&gt;</c> used while no delivery
    /// channel is configured.
    /// </summary>
    /// <remarks>
    /// Two things matter about it, on every one of Identity's three sends: that the missing channel
    /// is impossible to miss in the logs, and that the credential never reaches them. What it
    /// replaces is Identity's own <c>DefaultMessageEmailSender</c> → <c>NoOpEmailSender</c> chain,
    /// which discards the message and says nothing at all.
    /// </remarks>
    public class UndeliveredIdentityEmailSenderTests
    {
        private const string Email = "someone@example.com";
        private const string Secret = "CfDJ8-super-secret-credential";

        [Fact]
        public async Task SendPasswordResetCodeAsync_LogsADistinguishableWarning_WithoutTheCode()
        {
            var entry = await SendAsync((sender, user) =>
                sender.SendPasswordResetCodeAsync(user, Email, Secret));

            entry.EventId.Name.Should().Be("PasswordResetTokenUndelivered");
            entry.Message.Should().Contain("Password reset token issued");
        }

        [Fact]
        public async Task SendPasswordResetLinkAsync_LogsADistinguishableWarning_WithoutTheLink()
        {
            var entry = await SendAsync((sender, user) =>
                sender.SendPasswordResetLinkAsync(user, Email, Secret));

            entry.EventId.Name.Should().Be("PasswordResetTokenUndelivered");
        }

        [Fact]
        public async Task SendConfirmationLinkAsync_LogsADistinguishableWarning_WithoutTheLink()
        {
            var entry = await SendAsync((sender, user) =>
                sender.SendConfirmationLinkAsync(user, Email, Secret));

            // A separate event id from the reset one: the two failures need separate alerts, because
            // one means nobody can recover an account and the other means nobody can create one.
            entry.EventId.Name.Should().Be("EmailConfirmationLinkUndelivered");
            entry.Message.Should().Contain("Email confirmation link issued");
        }

        /// <summary>
        /// Runs one send and returns the single log entry it produced, asserting the guarantees that
        /// hold for every send: a warning, identifiable without matching on prose, naming the
        /// address and never the credential.
        /// </summary>
        private static async Task<(LogLevel Level, EventId EventId, string Message)> SendAsync(
            Func<UndeliveredIdentityEmailSender, ApplicationUser, Task> send)
        {
            var logger = new CapturingLogger();
            var sender = new UndeliveredIdentityEmailSender(logger);

            await send(sender, new ApplicationUser { Email = Email });

            var entry = logger.Entries.Should().ContainSingle().Subject;

            // Loud, not silent — and identifiable by event id, so an alert need not match on prose.
            entry.Level.Should().Be(LogLevel.Warning);
            entry.EventId.Name.Should().NotBeNullOrEmpty();
            entry.Message.Should().Contain(Email);
            entry.Message.Should().Contain("no delivery channel");

            // The link and the code are both bearer credentials for the account. Neither goes to a
            // shared sink, where the audience is larger than the account holder.
            entry.Message.Should().NotContain(Secret);

            return entry;
        }

        private sealed class CapturingLogger : ILogger<UndeliveredIdentityEmailSender>
        {
            internal List<(LogLevel Level, EventId EventId, string Message)> Entries { get; } = new();

            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                ArgumentNullException.ThrowIfNull(formatter);
                this.Entries.Add((logLevel, eventId, formatter(state, exception)));
            }
        }
    }
}
