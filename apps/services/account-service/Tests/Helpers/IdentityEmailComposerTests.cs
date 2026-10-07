// <copyright file="IdentityEmailComposerTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Helpers;
using FluentAssertions;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Unit tests for <see cref="IdentityEmailComposer"/> and the options it reads.
    /// </summary>
    public class IdentityEmailComposerTests
    {
        [Fact]
        public void EveryMessage_EndsWithTheConfiguredBrokerageDisclosure()
        {
            var composer = CreateComposer();

            composer.Code("person@example.com", "482913", TimeSpan.FromMinutes(10)).TextBody
                .Should().EndWith("Cribstop is brokered by Real Broker, LLC.");
            composer.AlreadyRegistered("person@example.com").TextBody
                .Should().EndWith("Cribstop is brokered by Real Broker, LLC.");
        }

        [Fact]
        public void AlreadyRegistered_IsTaggedAccordingly_AndNamesNoLinkOrCode()
        {
            var message = CreateComposer().AlreadyRegistered("person@example.com");

            message.Kind.Should().Be(EmailKind.AlreadyRegistered);
            message.To.Should().Be("person@example.com");
            message.TextBody.Should().Contain("already exists");
            message.TextBody.Should().Contain("Forgot password?");
        }

        [Fact]
        public void Code_PutsTheCodeInTheSubject_AndTheBody_WithLifetimeIgnoreLineAndDisclosure()
        {
            var message = ComposeCodeMessage("person@example.com", "482913");

            message.Kind.Should().Be(EmailKind.Code);
            message.To.Should().Be("person@example.com");
            message.Subject.Should().Be("482913 is your Cribstop code");
            message.TextBody.Should().Contain("\n\n482913\n\n");
            message.TextBody.Should().Contain("expires in 10 minutes");
            message.TextBody.Should().Contain("Not you? Ignore this message.");
            message.TextBody.Should().EndWith("Cribstop is brokered by Real Broker, LLC.");
            message.TextBody.Should().NotContain("http");
        }

        [Fact]
        public void AccountRecoveryOptions_RequireAnAbsoluteWebBaseUrl_AndRootedPaths()
        {
            new AccountRecoveryOptions().Validate().Should().Contain("WebBaseUrl");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("ftp://x.example") }.Validate()
                .Should().Contain("http");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), SecureAccountPath = "secure" }.Validate()
                .Should().Contain("SecureAccountPath");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example") }.Validate().Should().BeNull();
        }

        [Fact]
        public void TransactionalEmailOptions_RefuseAReplyToThatIsTheNoReplyAddress()
        {
            var options = new TransactionalEmailOptions
            {
                FromName = "Cribstop (Real Broker, LLC)",
                FromAddress = "no-reply@cribstop.com",
                ReplyToAddress = "NO-REPLY@cribstop.com",
                BrokerageDisclosure = "Cribstop is brokered by Real Broker, LLC.",
            };

            options.Validate().Should().Contain("ReplyToAddress");

            options.ReplyToAddress = "contact@cribstop.com";
            options.Validate().Should().BeNull();

            options.BrokerageDisclosure = string.Empty;
            options.Validate().Should().Contain("BrokerageDisclosure");
        }

        [Fact]
        public void PostmarkOptions_IsConfigured_OnlyWhenTheTokenIsNotThePlaceholder()
        {
            new PostmarkOptions().IsConfigured.Should().BeFalse();
            new PostmarkOptions { ServerToken = string.Empty }.IsConfigured.Should().BeFalse();
            new PostmarkOptions { ServerToken = "real-server-token" }.IsConfigured.Should().BeTrue();
        }

        [Fact]
        public void PostmarkOptions_Validate_RequiresAMessageStreamAndAnAbsoluteApiBaseUrl()
        {
            new PostmarkOptions { MessageStream = string.Empty }.Validate().Should().Contain("MessageStream");
            new PostmarkOptions { ApiBaseUrl = new Uri("not-absolute", UriKind.Relative) }.Validate()
                .Should().Contain("ApiBaseUrl");
            new PostmarkOptions().Validate().Should().BeNull();
        }

        /// <summary>Composes a code message with the standard test composer.</summary>
        /// <param name="to">The recipient.</param>
        /// <param name="code">The code.</param>
        /// <returns>The message.</returns>
        internal static OutboundEmail ComposeCodeMessage(string to, string code) =>
            CreateComposer().Code(to, code, TimeSpan.FromMinutes(10));

        private static IdentityEmailComposer CreateComposer() =>
            new(
                Options.Create(new TransactionalEmailOptions
                {
                    FromName = "Cribstop (Real Broker, LLC)",
                    FromAddress = "no-reply@cribstop.com",
                    ReplyToAddress = "contact@cribstop.com",
                    BrokerageDisclosure = "Cribstop is brokered by Real Broker, LLC.",
                }));
    }
}
