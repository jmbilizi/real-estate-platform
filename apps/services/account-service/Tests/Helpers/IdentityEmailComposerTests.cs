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
    /// Unit tests for <see cref="ConfirmationLinkBuilder"/>, <see cref="IdentityEmailComposer"/>
    /// and the options they read.
    /// </summary>
    public class IdentityEmailComposerTests
    {
        private const string InClusterLink =
            "http://account-service-svc:8080/account/confirmEmail?userId=user-1&amp;code=Q29kZQ";

        [Fact]
        public void Build_UsesTheConfiguredOriginAndPath_WithIdentitysUserIdAndCode()
        {
            var builder = CreateBuilder();

            var link = builder.Build("user-1", "Q29kZQ");

            link.Should().Be(new Uri("https://cribstop.example/confirm-email?userId=user-1&code=Q29kZQ"));
        }

        [Fact]
        public void Rebuild_ReplacesTheInClusterHost_AndKeepsTheQuery()
        {
            var builder = CreateBuilder();

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
            var link = CreateBuilder().Rebuild(InClusterLink + "&amp;changedEmail=new%40example.com");

            link.Query.Should().Contain("changedEmail=new@example.com");
        }

        [Fact]
        public void Rebuild_Throws_WhenTheLinkCarriesNoCode()
        {
            var builder = CreateBuilder();

            var act = () => builder.Rebuild("http://account-service-svc:8080/account/confirmEmail?userId=user-1");

            act.Should().Throw<InvalidOperationException>();
        }

        [Fact]
        public void ConfirmationLink_CarriesTheSettledSenderIdentity_AndTheRebuiltLink()
        {
            var composer = CreateComposer();

            var message = composer.ConfirmationLink("person@example.com", InClusterLink);

            message.FromName.Should().Be("Cribstop (Real Broker, LLC)");
            message.FromAddress.Should().Be("no-reply@cribstop.com");
            message.ReplyToAddress.Should().Be("contact@cribstop.com");
            message.To.Should().Be("person@example.com");
            message.TextBody.Should().Contain("https://cribstop.example/confirm-email?userId=user-1&code=Q29kZQ");
            message.TextBody.Should().NotContain("account-service-svc");
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
        }

        [Fact]
        public void PasswordResetCode_DecodesTheCodeIdentityEncoded()
        {
            var message = CreateComposer().PasswordResetCode("person@example.com", "abc&#x2B;def");

            message.TextBody.Should().Contain("abc+def");
            message.ReplyToAddress.Should().Be("contact@cribstop.com");
        }

        [Fact]
        public void AccountRecoveryOptions_RequireAnAbsoluteWebBaseUrl_AndARootedPath()
        {
            new AccountRecoveryOptions { ConfirmationPath = "/confirm-email" }.Validate()
                .Should().Contain("WebBaseUrl");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("ftp://x.example"), ConfirmationPath = "/x" }.Validate()
                .Should().Contain("http");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "confirm" }.Validate()
                .Should().Contain("ConfirmationPath");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "/confirm-email" }.Validate()
                .Should().BeNull();
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

        private static ConfirmationLinkBuilder CreateBuilder() =>
            new(Options.Create(new AccountRecoveryOptions
            {
                WebBaseUrl = new Uri("https://cribstop.example"),
                ConfirmationPath = "/confirm-email",
            }));

        private static IdentityEmailComposer CreateComposer() =>
            new(
                Options.Create(new TransactionalEmailOptions
                {
                    FromName = "Cribstop (Real Broker, LLC)",
                    FromAddress = "no-reply@cribstop.com",
                    ReplyToAddress = "contact@cribstop.com",
                    BrokerageDisclosure = "Cribstop is brokered by Real Broker, LLC.",
                }),
                CreateBuilder());
    }
}
