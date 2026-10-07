// <copyright file="IdentityEmailComposerTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Helpers;
using FluentAssertions;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Unit tests for <see cref="PasswordResetLinkBuilder"/>,
    /// <see cref="IdentityEmailComposer"/>, and the options they read.
    /// </summary>
    public class IdentityEmailComposerTests
    {
        [Fact]
        public void PasswordResetLinkBuilder_CarriesTheEmailAndTheCode()
        {
            var builder = CreatePasswordResetBuilder();

            var link = builder.Build("person@example.com", "abc+def");
            var query = QueryHelpers.ParseQuery(link.Query);

            link.GetLeftPart(UriPartial.Path).Should().Be("https://cribstop.example/reset-password");
            query["email"].ToString().Should().Be("person@example.com");
            query["code"].ToString().Should().Be("abc+def");
        }

        [Fact]
        public void EveryMessage_EndsWithTheConfiguredBrokerageDisclosure()
        {
            var composer = CreateComposer();

            composer.PasswordResetCode("person@example.com", "code").TextBody
                .Should().EndWith("Cribstop is brokered by Real Broker, LLC.");
            composer.PasswordResetLink("person@example.com", "https://cribstop.example/reset").TextBody
                .Should().EndWith("Cribstop is brokered by Real Broker, LLC.");
            composer.AlreadyRegistered("person@example.com").TextBody
                .Should().EndWith("Cribstop is brokered by Real Broker, LLC.");
        }

        [Fact]
        public void PasswordResetCode_BuildsALink_CarryingTheDecodedCodeAndTheEmail_AndTheConfiguredExpiry()
        {
            var message = CreateComposer().PasswordResetCode("person@example.com", "abc&#x2B;def");

            var link = ExtractLink(message.TextBody);
            var query = QueryHelpers.ParseQuery(link.Query);
            link.GetLeftPart(UriPartial.Path).Should().Be("https://cribstop.example/reset-password");
            query["email"].ToString().Should().Be("person@example.com");
            query["code"].ToString().Should().Be("abc+def");
            message.TextBody.Should().Contain("expires in 1 hour");
            message.ReplyToAddress.Should().Be("contact@cribstop.com");
        }

        [Fact]
        public void PasswordResetCode_IsTaggedAsAPasswordResetMessage()
        {
            CreateComposer().PasswordResetCode("person@example.com", "code").Kind
                .Should().Be(EmailKind.PasswordReset);
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
            new AccountRecoveryOptions { PasswordResetPath = "/reset-password" }.Validate()
                .Should().Contain("WebBaseUrl");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("ftp://x.example"), PasswordResetPath = "/y" }.Validate()
                .Should().Contain("http");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), PasswordResetPath = "reset" }.Validate()
                .Should().Contain("PasswordResetPath");

            new AccountRecoveryOptions
            {
                WebBaseUrl = new Uri("https://x.example"),
                PasswordResetPath = "/reset-password",
            }.Validate().Should().BeNull();
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

        private static Uri ExtractLink(string body)
        {
            var start = body.IndexOf("https://", StringComparison.Ordinal);
            var end = body.IndexOf('\n', start);
            return new Uri(body[start..end]);
        }

        private static PasswordResetLinkBuilder CreatePasswordResetBuilder() =>
            new(Options.Create(CreateRecoveryOptions()));

        private static AccountRecoveryOptions CreateRecoveryOptions() => new()
        {
            WebBaseUrl = new Uri("https://cribstop.example"),
            PasswordResetPath = "/reset-password",
            TokenLifetime = TimeSpan.FromHours(1),
        };

        private static IdentityEmailComposer CreateComposer() =>
            new(
                Options.Create(new TransactionalEmailOptions
                {
                    FromName = "Cribstop (Real Broker, LLC)",
                    FromAddress = "no-reply@cribstop.com",
                    ReplyToAddress = "contact@cribstop.com",
                    BrokerageDisclosure = "Cribstop is brokered by Real Broker, LLC.",
                }),
                Options.Create(CreateRecoveryOptions()),
                CreatePasswordResetBuilder());
    }
}
