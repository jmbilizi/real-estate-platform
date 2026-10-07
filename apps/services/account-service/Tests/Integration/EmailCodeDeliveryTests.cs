// <copyright file="EmailCodeDeliveryTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for the email code engine inside the real host: DI wiring, the real
    /// composer, and the delivery seam. Nothing calls the engine over HTTP yet.
    /// </summary>
    public class EmailCodeDeliveryTests
    {
        private const string Email = "person@example.com";

        [Fact]
        public async Task Issue_HandsTheComposedCodeMessageToTheDeliverySeam_AndVerifyAcceptsIt()
        {
            using var factory = new AccountRecoveryFactory();
            using var scope = factory.Services.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<EmailCodeService>();

            var issued = await service.IssueAsync(Email, EmailCodePurpose.SignUp);

            issued.Status.Should().Be(EmailCodeIssueStatus.Issued);

            // The recording sender keeps every message handed to IOutboundEmailSender here.
            var message = factory.AlreadyRegisteredNotices.Should().ContainSingle().Subject;
            message.Kind.Should().Be(EmailKind.Code);
            message.To.Should().Be(Email);
            var code = message.Subject.Split(' ')[0];
            code.Should().MatchRegex("^[0-9]{6}$");
            message.TextBody.Should().Contain(code);
            message.TextBody.Should().Contain("Real Broker, LLC");

            (await service.VerifyAsync(Email, EmailCodePurpose.SignUp, code)).Status
                .Should().Be(EmailCodeVerifyStatus.Verified);
        }

        [Fact]
        public void TheTestHost_UsesTheDevelopmentKey_AndTheEpicPolicy()
        {
            using var factory = new AccountRecoveryFactory();

            var settings = factory.Services.GetRequiredService<IOptions<EmailCodeOptions>>().Value;

            settings.IsConfigured.Should().BeTrue();
            settings.HmacKey.Should().Be(EmailCodeOptions.DevelopmentKey);
            settings.MaxWrongTries.Should().Be(5);
            settings.Lifetime.Should().Be(TimeSpan.FromMinutes(10));
        }
    }
}
