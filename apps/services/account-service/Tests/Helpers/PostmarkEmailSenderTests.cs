// <copyright file="PostmarkEmailSenderTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Unit tests for <see cref="PostmarkEmailSender"/>: it composes and hands the result to the
    /// delivery seam, and is not itself a second delivery path.
    /// </summary>
    public class PostmarkEmailSenderTests
    {
        private const string InClusterLink =
            "http://account-service-svc:8080/account/confirmEmail?userId=user-1&amp;code=Q29kZQ";

        [Fact]
        public async Task SendConfirmationLinkAsync_HandsTheComposedMessage_ToTheDeliverySeam()
        {
            var (sender, sent) = CreateSender();

            await sender.SendConfirmationLinkAsync(new ApplicationUser(), "person@example.com", InClusterLink);

            var message = sent.Should().ContainSingle().Subject;
            message.Kind.Should().Be(EmailKind.Confirmation);
            message.To.Should().Be("person@example.com");
        }

        [Fact]
        public async Task SendPasswordResetCodeAsync_HandsTheComposedMessage_ToTheDeliverySeam()
        {
            var (sender, sent) = CreateSender();

            await sender.SendPasswordResetCodeAsync(new ApplicationUser(), "person@example.com", "code");

            var message = sent.Should().ContainSingle().Subject;
            message.Kind.Should().Be(EmailKind.PasswordReset);
            message.To.Should().Be("person@example.com");
        }

        [Fact]
        public async Task SendPasswordResetLinkAsync_HandsTheComposedMessage_ToTheDeliverySeam()
        {
            var (sender, sent) = CreateSender();

            await sender.SendPasswordResetLinkAsync(new ApplicationUser(), "person@example.com", "https://cribstop.example/reset");

            var message = sent.Should().ContainSingle().Subject;
            message.Kind.Should().Be(EmailKind.PasswordReset);
        }

        private static (PostmarkEmailSender Sender, List<OutboundEmail> Sent) CreateSender()
        {
            var recovery = Options.Create(new AccountRecoveryOptions
            {
                WebBaseUrl = new Uri("https://cribstop.example"),
                ConfirmationPath = "/confirm-email",
                PasswordResetPath = "/reset-password",
            });
            var composer = new IdentityEmailComposer(
                Options.Create(new TransactionalEmailOptions
                {
                    FromName = "Cribstop (Real Broker, LLC)",
                    FromAddress = "no-reply@cribstop.com",
                    ReplyToAddress = "contact@cribstop.com",
                    BrokerageDisclosure = "Cribstop is brokered by Real Broker, LLC.",
                }),
                recovery,
                new ConfirmationLinkBuilder(recovery),
                new PasswordResetLinkBuilder(recovery));

            var sent = new List<OutboundEmail>();
            var outbound = new RecordingOutbound(sent);
            return (new PostmarkEmailSender(composer, outbound), sent);
        }

        private sealed class RecordingOutbound(List<OutboundEmail> sent) : IOutboundEmailSender
        {
            public Task SendAsync(OutboundEmail message, CancellationToken cancellationToken = default)
            {
                sent.Add(message);
                return Task.CompletedTask;
            }
        }
    }
}
