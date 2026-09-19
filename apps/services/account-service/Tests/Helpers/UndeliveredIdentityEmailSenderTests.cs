// <copyright file="UndeliveredIdentityEmailSenderTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Unit tests for <see cref="UndeliveredIdentityEmailSender"/>.
    /// </summary>
    public class UndeliveredIdentityEmailSenderTests
    {
        private const string Email = "person@example.com";
        private const string Code = "Q29kZQ-SECRET";
        private const string Link = "http://account-service-svc:8080/account/confirmEmail?userId=u1&amp;code=" + Code;

        [Fact]
        public async Task SendConfirmationLinkAsync_WarnsWithTheConfirmationEventId_AndNeverLogsTheLink()
        {
            var entry = await SendAsync((sender, user) => sender.SendConfirmationLinkAsync(user, Email, Link));

            entry.EventId.Should().Be(UndeliveredIdentityEmailSender.UndeliveredConfirmationEvent);
        }

        [Fact]
        public async Task SendPasswordResetCodeAsync_WarnsWithTheResetEventId_AndNeverLogsTheCode()
        {
            var entry = await SendAsync((sender, user) => sender.SendPasswordResetCodeAsync(user, Email, Code));

            entry.EventId.Should().Be(UndeliveredIdentityEmailSender.UndeliveredResetEvent);
        }

        [Fact]
        public async Task SendPasswordResetLinkAsync_WarnsWithTheResetEventId_AndNeverLogsTheLink()
        {
            var entry = await SendAsync((sender, user) => sender.SendPasswordResetLinkAsync(user, Email, Link));

            entry.EventId.Should().Be(UndeliveredIdentityEmailSender.UndeliveredResetEvent);
        }

        private static async Task<(LogLevel Level, EventId EventId, string Message)> SendAsync(
            Func<UndeliveredIdentityEmailSender, ApplicationUser, Task> send)
        {
            var logger = new CapturingLogger();
            var composer = new IdentityEmailComposer(
                Options.Create(new TransactionalEmailOptions
                {
                    FromName = "Cribstop (Real Broker, LLC)",
                    FromAddress = "no-reply@cribstop.com",
                    ReplyToAddress = "contact@cribstop.com",
                    BrokerageDisclosure = "Cribstop is brokered by Real Broker, LLC.",
                }),
                new ConfirmationLinkBuilder(Options.Create(new AccountRecoveryOptions
                {
                    WebBaseUrl = new Uri("https://cribstop.example"),
                    ConfirmationPath = "/confirm-email",
                })));
            var sender = new UndeliveredIdentityEmailSender(composer, logger);

            await send(sender, new ApplicationUser { Email = Email });

            var entry = logger.Entries.Should().ContainSingle().Subject;

            entry.Level.Should().Be(LogLevel.Warning);
            entry.Message.Should().Contain(Email);
            entry.Message.Should().Contain("no-reply@cribstop.com");
            entry.Message.Should().Contain("contact@cribstop.com");
            entry.Message.Should().Contain("no delivery channel");

            // The link and the code are bearer credentials for the account.
            entry.Message.Should().NotContain(Code);
            entry.Message.Should().NotContain("confirm-email");
            entry.Message.Should().NotContain("account-service-svc");

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
