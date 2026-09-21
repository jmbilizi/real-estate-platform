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
    /// Unit tests for <see cref="ConfirmationLinkBuilder"/>, <see cref="PasswordResetLinkBuilder"/>,
    /// <see cref="IdentityEmailComposer"/>, and the options they read.
    /// </summary>
    public class IdentityEmailComposerTests
    {
        private const string InClusterLink =
            "http://account-service-svc:8080/account/confirmEmail?userId=user-1&amp;code=Q29kZQ";

        [Fact]
        public void Build_UsesTheConfiguredOriginAndPath_WithIdentitysUserIdAndCode()
        {
            var builder = CreateConfirmationBuilder();

            var link = builder.Build("user-1", "Q29kZQ");

            link.Should().Be(new Uri("https://cribstop.example/confirm-email?userId=user-1&code=Q29kZQ"));
        }

        [Fact]
        public void Rebuild_ReplacesTheInClusterHost_AndKeepsTheQuery()
        {
            var builder = CreateConfirmationBuilder();

            // Identity HTML-encodes the link before it reaches the sender. The in-cluster host is
            // what LinkGenerator produces behind Ocelot.
            var link = builder.Rebuild(InClusterLink);

            link.GetLeftPart(UriPartial.Authority).Should().Be("https://cribstop.example");
            link.AbsolutePath.Should().Be("/confirm-email");
            link.Query.Should().Be("?userId=user-1&code=Q29kZQ");
        }

        [Fact]
        public void Rebuild_CarriesChangedEmail_ForTheEmailChangeFlow()
        {
            var link = CreateConfirmationBuilder().Rebuild(InClusterLink + "&amp;changedEmail=new%40example.com");

            link.Query.Should().Contain("changedEmail=new@example.com");
        }

        [Fact]
        public void Rebuild_Throws_WhenTheLinkCarriesNoCode()
        {
            var builder = CreateConfirmationBuilder();

            var act = () => builder.Rebuild("http://account-service-svc:8080/account/confirmEmail?userId=user-1");

            act.Should().Throw<InvalidOperationException>();
        }

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
        public void ConfirmationLink_CarriesTheSettledSenderIdentity_TheRebuiltLink_AndTheConfiguredExpiry()
        {
            var composer = CreateComposer();

            var message = composer.ConfirmationLink("person@example.com", InClusterLink);

            message.FromName.Should().Be("Cribstop (Real Broker, LLC)");
            message.FromAddress.Should().Be("no-reply@cribstop.com");
            message.ReplyToAddress.Should().Be("contact@cribstop.com");
            message.To.Should().Be("person@example.com");
            message.TextBody.Should().Contain("https://cribstop.example/confirm-email?userId=user-1&code=Q29kZQ");
            message.TextBody.Should().NotContain("account-service-svc");
            message.TextBody.Should().Contain("expires in 1 day");
            message.TextBody.Should().EndWith("Cribstop is brokered by Real Broker, LLC.");
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
        public void ConfirmationLink_IsTaggedAsAConfirmationMessage()
        {
            CreateComposer().ConfirmationLink("person@example.com", InClusterLink).Kind
                .Should().Be(EmailKind.Confirmation);
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
        public void AccountRecoveryOptions_RequireAnAbsoluteWebBaseUrl_AndRootedPaths()
        {
            new AccountRecoveryOptions { ConfirmationPath = "/confirm-email", PasswordResetPath = "/reset-password" }.Validate()
                .Should().Contain("WebBaseUrl");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("ftp://x.example"), ConfirmationPath = "/x", PasswordResetPath = "/y" }.Validate()
                .Should().Contain("http");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "confirm", PasswordResetPath = "/y" }.Validate()
                .Should().Contain("ConfirmationPath");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "/confirm-email", PasswordResetPath = "reset" }.Validate()
                .Should().Contain("PasswordResetPath");

            new AccountRecoveryOptions
            {
                WebBaseUrl = new Uri("https://x.example"),
                ConfirmationPath = "/confirm-email",
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

        private static Uri ExtractLink(string body)
        {
            var start = body.IndexOf("https://", StringComparison.Ordinal);
            var end = body.IndexOf('\n', start);
            return new Uri(body[start..end]);
        }

        private static ConfirmationLinkBuilder CreateConfirmationBuilder() =>
            new(Options.Create(CreateRecoveryOptions()));

        private static PasswordResetLinkBuilder CreatePasswordResetBuilder() =>
            new(Options.Create(CreateRecoveryOptions()));

        private static AccountRecoveryOptions CreateRecoveryOptions() => new()
        {
            WebBaseUrl = new Uri("https://cribstop.example"),
            ConfirmationPath = "/confirm-email",
            PasswordResetPath = "/reset-password",
            ConfirmationTokenLifetime = TimeSpan.FromHours(24),
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
                CreateConfirmationBuilder(),
                CreatePasswordResetBuilder());
    }
}
