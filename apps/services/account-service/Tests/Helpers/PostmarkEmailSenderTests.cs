// <copyright file="PostmarkEmailSenderTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Unit tests for <see cref="PostmarkEmailSender"/>: every Identity send is retired and throws.
    /// </summary>
    public class PostmarkEmailSenderTests
    {
        [Fact]
        public async Task SendConfirmationLinkAsync_Throws()
        {
            var act = () => new PostmarkEmailSender().SendConfirmationLinkAsync(new ApplicationUser(), "person@example.com", "https://cribstop.example/link");

            await act.Should().ThrowAsync<NotSupportedException>();
        }

        [Fact]
        public async Task SendPasswordResetLinkAsync_Throws()
        {
            var act = () => new PostmarkEmailSender().SendPasswordResetLinkAsync(new ApplicationUser(), "person@example.com", "https://cribstop.example/reset");

            await act.Should().ThrowAsync<NotSupportedException>();
        }

        [Fact]
        public async Task SendPasswordResetCodeAsync_Throws()
        {
            var act = () => new PostmarkEmailSender().SendPasswordResetCodeAsync(new ApplicationUser(), "person@example.com", "code");

            await act.Should().ThrowAsync<NotSupportedException>();
        }
    }
}
