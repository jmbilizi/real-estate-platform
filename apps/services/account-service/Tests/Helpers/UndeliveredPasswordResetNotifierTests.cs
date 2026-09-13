// <copyright file="UndeliveredPasswordResetNotifierTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Helpers;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Tests for the stand-in notifier used while no delivery channel is configured.
    /// </summary>
    /// <remarks>
    /// Two things matter about it: that the missing channel is impossible to miss in the logs, and
    /// that the token never reaches them.
    /// </remarks>
    public class UndeliveredPasswordResetNotifierTests
    {
        [Fact]
        public async Task SendPasswordResetAsync_LogsADistinguishableWarning_WithoutTheToken()
        {
            var logger = new CapturingLogger();
            var notifier = new UndeliveredPasswordResetNotifier(logger);

            await notifier.SendPasswordResetAsync(
                "someone@example.com",
                "CfDJ8-super-secret-reset-code",
                CancellationToken.None);

            var entry = logger.Entries.Should().ContainSingle().Subject;

            // Loud, not silent — and identifiable by event id, so an alert need not match on prose.
            entry.Level.Should().Be(LogLevel.Warning);
            entry.EventId.Name.Should().Be("PasswordResetTokenUndelivered");
            entry.Message.Should().Contain("someone@example.com");
            entry.Message.Should().Contain("no delivery channel");

            // The token is a bearer credential for the account. It does not go to a shared sink.
            entry.Message.Should().NotContain("CfDJ8-super-secret-reset-code");
        }

        private sealed class CapturingLogger : ILogger<UndeliveredPasswordResetNotifier>
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
