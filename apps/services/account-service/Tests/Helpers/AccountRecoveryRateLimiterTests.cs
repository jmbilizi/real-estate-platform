// <copyright file="AccountRecoveryRateLimiterTests.cs" company="PlaceholderCompany">
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
    /// Unit tests for <see cref="AccountRecoveryRateLimiter"/>.
    /// </summary>
    public class AccountRecoveryRateLimiterTests : IDisposable
    {
        private readonly List<AccountRecoveryRateLimiter> limiters = new();

        /// <inheritdoc/>
        public void Dispose()
        {
            foreach (var limiter in this.limiters)
            {
                limiter.Dispose();
            }

            this.limiters.Clear();
            GC.SuppressFinalize(this);
        }

        [Fact]
        public void TryRequest_CountsPerEmail_IndependentlyOfTheCaller()
        {
            var limiter = this.Create(options =>
            {
                options.RequestsPerEmail = 2;
                options.RequestsPerAddress = 100;
            });

            limiter.TryRequest("victim@example.com", "10.0.0.1", out _).Should().BeTrue();
            limiter.TryRequest("victim@example.com", "10.0.0.2", out _).Should().BeTrue();

            // Spreading the requests across client addresses does not buy more attempts against
            // one mailbox.
            limiter.TryRequest("victim@example.com", "10.0.0.3", out var retryAfter).Should().BeFalse();
            retryAfter.Should().BePositive();

            limiter.TryRequest("someone-else@example.com", "10.0.0.3", out _).Should().BeTrue();
        }

        [Fact]
        public void TryRequest_TreatsTheEmailCaseInsensitively()
        {
            var limiter = this.Create(options => options.RequestsPerEmail = 1);

            limiter.TryRequest("Victim@Example.com", "10.0.0.1", out _).Should().BeTrue();
            limiter.TryRequest("victim@example.COM", "10.0.0.1", out _).Should().BeFalse();
        }

        [Fact]
        public void TryRequest_CountsPerClientAddress_AcrossDifferentEmails()
        {
            var limiter = this.Create(options =>
            {
                options.RequestsPerEmail = 100;
                options.RequestsPerAddress = 2;
            });

            limiter.TryRequest("a@example.com", "10.0.0.9", out _).Should().BeTrue();
            limiter.TryRequest("b@example.com", "10.0.0.9", out _).Should().BeTrue();
            limiter.TryRequest("c@example.com", "10.0.0.9", out _).Should().BeFalse();

            // A different caller is unaffected.
            limiter.TryRequest("d@example.com", "10.0.0.10", out _).Should().BeTrue();
        }

        [Fact]
        public void TryRequest_ConsumesBothBudgets_EvenWhenTheFirstAlreadyRefused()
        {
            var limiter = this.Create(options =>
            {
                options.RequestsPerEmail = 1;
                options.RequestsPerAddress = 2;
            });

            limiter.TryRequest("a@example.com", "10.0.0.1", out _).Should().BeTrue();

            // Refused on the email budget — but the client-address budget is spent all the same,
            // so hammering one mailbox is not a free way to stay under the caller's limit.
            limiter.TryRequest("a@example.com", "10.0.0.1", out _).Should().BeFalse();
            limiter.TryRequest("b@example.com", "10.0.0.1", out _).Should().BeFalse();
        }

        [Fact]
        public void TryRedemption_IsCountedSeparatelyFromRequests()
        {
            var limiter = this.Create(options =>
            {
                options.RequestsPerAddress = 1;
                options.RedemptionsPerAddress = 2;
            });

            limiter.TryRequest("a@example.com", "10.0.0.1", out _).Should().BeTrue();
            limiter.TryRequest("b@example.com", "10.0.0.1", out _).Should().BeFalse();

            // Exhausting the request budget must not lock a legitimate holder out of redeeming the
            // token they already have.
            limiter.TryRedemption("10.0.0.1", out _).Should().BeTrue();
            limiter.TryRedemption("10.0.0.1", out _).Should().BeTrue();
            limiter.TryRedemption("10.0.0.1", out _).Should().BeFalse();
        }

        [Fact]
        public void TryResend_IsCountedSeparatelyFromResetRequests()
        {
            var limiter = this.Create(options =>
            {
                options.RequestsPerEmail = 1;
                options.ResendsPerEmail = 1;
            });

            limiter.TryRequest("a@example.com", "10.0.0.1", out _).Should().BeTrue();
            limiter.TryRequest("a@example.com", "10.0.0.1", out _).Should().BeFalse();

            // Asking for a reset link and asking for a confirmation link are different asks about
            // the same address. Spending one budget must not spend the other, or a person who
            // mistyped their way through a reset could no longer confirm their address at all.
            limiter.TryResend("a@example.com", "10.0.0.1", out _).Should().BeTrue();
            limiter.TryResend("a@example.com", "10.0.0.1", out var retryAfter).Should().BeFalse();
            retryAfter.Should().BePositive();
        }

        [Fact]
        public void TryRegistration_IsCountedPerAddress_AndSeparatelyFromEverythingElse()
        {
            var limiter = this.Create(options =>
            {
                options.RegistrationsPerAddress = 2;
                options.RequestsPerAddress = 1;
            });

            limiter.TryRegistration("10.0.0.1", out _).Should().BeTrue();
            limiter.TryRegistration("10.0.0.1", out _).Should().BeTrue();
            limiter.TryRegistration("10.0.0.1", out _).Should().BeFalse();

            // A different caller is unaffected — the whole risk of limiting registration per
            // address is denying a stranger behind the same NAT, so the buckets must not bleed.
            limiter.TryRegistration("10.0.0.2", out _).Should().BeTrue();
        }

        [Fact]
        public void TryRequest_GroupsCallersWithNoAddress_RatherThanExemptingThem()
        {
            var limiter = this.Create(options =>
            {
                options.RequestsPerEmail = 100;
                options.RequestsPerAddress = 1;
            });

            limiter.TryRequest("a@example.com", null, out _).Should().BeTrue();
            limiter.TryRequest("b@example.com", null, out _).Should().BeFalse();
        }

        private AccountRecoveryRateLimiter Create(Action<AccountRecoveryOptions> configure)
        {
            var options = new AccountRecoveryOptions();
            configure(options);

            var limiter = new AccountRecoveryRateLimiter(Options.Create(options), TimeProvider.System);
            this.limiters.Add(limiter);
            return limiter;
        }
    }
}
