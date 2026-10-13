// <copyright file="IdentityEmailComposerTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text.RegularExpressions;
using AccountService.Configuration;
using AccountService.Helpers;
using AccountService.Models;
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
        public void Code_KeepsTheCodeOutOfTheSubject_AndPutsItInTheBody_WithLifetimeIgnoreLineAndDisclosure()
        {
            var message = ComposeCodeMessage("person@example.com", "482913");

            message.Kind.Should().Be(EmailKind.Code);
            message.To.Should().Be("person@example.com");
            message.Subject.Should().Be("Your Cribstop verification code");
            message.Subject.Should().NotMatchRegex(@"\d");
            message.TextBody.Should().Contain("\n\n482913\n\n");
            message.TextBody.Should().Contain("expires in 10 minutes");
            message.TextBody.Should().Contain("Not you? Ignore this message.");
            message.TextBody.Should().EndWith("Cribstop is brokered by Real Broker, LLC.");
            message.TextBody.Should().NotContain("http");
        }

        [Theory]
        [InlineData("SignUp", "Verify your email")]
        [InlineData("PasswordReset", "Reset your password")]
        [InlineData("EmailChangeNew", "Confirm your new email")]
        [InlineData("EmailChangeOld", "Confirm your email change")]
        public void Code_Html_HoldsTheCodeOnce_WithPurposeHeading_AndTheFooter(string purposeName, string heading)
        {
            var purpose = Enum.Parse<EmailCodePurpose>(purposeName);
            var html = CreateComposer().Code("person@example.com", "482913", TimeSpan.FromMinutes(10), purpose).HtmlBody;

            html.Should().Contain($">{heading}</h1>");
            Regex.Matches(html, "482913").Should().HaveCount(1);
            html.Should().Contain("This code expires in 10 minutes.");
            html.Should().Contain("you can ignore this email");
            html.Should().Contain("Cribstop is brokered by Real Broker, LLC.");
            html.Should().Contain("href=\"https://cribstop.com/privacy\"");
            html.Should().Contain("href=\"https://cribstop.com/terms\"");
            html.Should().Contain("contact@cribstop.com");
            html.Should().Contain("#ff385c");
            html.Should().Contain("max-width:600px");
            html.Should().NotContain("<script").And.NotContain("src=");
        }

        [Fact]
        public void Code_Html_DerivesTheExpiryFromTheLifetime()
        {
            CreateComposer().Code("a@b.com", "123456", TimeSpan.FromMinutes(5)).HtmlBody
                .Should().Contain("This code expires in 5 minutes.");
        }

        [Fact]
        public void Html_EncodesEveryDynamicValue()
        {
            var composer = CreateComposer();
            const string Hostile = "<b>\"x\"&</b>";

            composer.Code("a@b.com", Hostile, TimeSpan.FromMinutes(10)).HtmlBody
                .Should().NotContain("<b>").And.Contain("&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;");
            composer.EmailChangedNotice("a@b.com", Hostile, DateTime.UtcNow, new Uri("https://cribstop.com/secure-account?token=a&b=\"c"), TimeSpan.FromDays(7)).HtmlBody
                .Should().NotContain("<b>").And.NotContain("b=\"c");
        }

        [Fact]
        public void EveryKind_HasAnHtmlBody_WithTheBrokerLine()
        {
            var composer = CreateComposer();
            var link = new Uri("https://cribstop.com/secure-account?token=abc");
            var messages = new[]
            {
                composer.Code("a@b.com", "482913", TimeSpan.FromMinutes(10)),
                composer.AlreadyRegistered("a@b.com"),
                composer.EmailChangedNotice("a@b.com", "f***@example.com", DateTime.UtcNow, link, TimeSpan.FromDays(7)),
                composer.PasswordChangedNotice("a@b.com", true, DateTime.UtcNow, link, TimeSpan.FromDays(7)),
                composer.PasswordChangedNotice("a@b.com", false, DateTime.UtcNow, link, TimeSpan.FromDays(7)),
            };

            foreach (var message in messages)
            {
                message.HtmlBody.Should().StartWith("<!DOCTYPE html>");
                message.HtmlBody.Should().Contain("Cribstop is brokered by Real Broker, LLC.");
                message.HtmlBody.Should().Contain("Privacy Policy");
            }

            messages[2].HtmlBody.Should().Contain("href=\"https://cribstop.com/secure-account?token=abc\"");
            messages[2].HtmlBody.Should().Contain("expires in 7 days");
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
                }),
                Options.Create(new AccountRecoveryOptions { WebBaseUrl = new Uri("https://cribstop.com") }));
    }
}
