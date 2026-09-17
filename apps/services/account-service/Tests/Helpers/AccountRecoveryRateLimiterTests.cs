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
        public void TryResend_EnforcesTheMinimumInterval_PerEmail()
        {
            var limiter = this.Create(options => options.ResendMinimumInterval = TimeSpan.FromSeconds(60));

            limiter.TryResend("victim@example.com", "10.0.0.1", out _).Should().BeTrue();
            limiter.TryResend("victim@example.com", "10.0.0.2", out var retryAfter).Should().BeFalse();
            retryAfter.Should().BeGreaterThan(TimeSpan.FromSeconds(55));

            limiter.TryResend("other@example.com", "10.0.0.2", out _).Should().BeTrue();
        }

        [Fact]
        public void TryResend_EnforcesTheHourlyAndDailyLimits_PerEmail()
        {
            var limiter = this.Create(options =>
            {
                options.ResendMinimumInterval = TimeSpan.Zero;
                options.ResendsPerEmailPerHour = 2;
                options.ResendsPerEmailPerDay = 3;
            });

            limiter.TryResend("victim@example.com", "10.0.0.1", out _).Should().BeTrue();
            limiter.TryResend("victim@example.com", "10.0.0.1", out _).Should().BeTrue();

            // Spreading requests across callers buys nothing against one mailbox.
            limiter.TryResend("victim@example.com", "10.0.0.9", out var retryAfter).Should().BeFalse();
            retryAfter.Should().BePositive();
        }

        [Fact]
        public void TryResend_ReportsTheLongestRefusingWindow()
        {
            var limiter = this.Create(options =>
            {
                options.ResendMinimumInterval = TimeSpan.FromSeconds(60);
                options.ResendsPerEmailPerHour = 1;
            });

            limiter.TryResend("victim@example.com", null, out _).Should().BeTrue();
            limiter.TryResend("victim@example.com", null, out var retryAfter).Should().BeFalse();

            // Both the interval and the hourly window refuse. Waiting 60s would not help.
            retryAfter.Should().BeGreaterThan(TimeSpan.FromMinutes(55));
        }

        [Fact]
        public void TryResend_TreatsTheEmailCaseInsensitively()
        {
            var limiter = this.Create(options => options.ResendMinimumInterval = TimeSpan.FromMinutes(1));

            limiter.TryResend("Victim@Example.com", "10.0.0.1", out _).Should().BeTrue();
            limiter.TryResend("victim@example.COM", "10.0.0.1", out _).Should().BeFalse();
        }

        [Fact]
        public void TryResend_CountsPerClientAddress_AcrossDifferentEmails()
        {
            var limiter = this.Create(options =>
            {
                options.ResendMinimumInterval = TimeSpan.Zero;
                options.ResendsPerAddress = 2;
            });

            limiter.TryResend("a@example.com", "10.0.0.1", out _).Should().BeTrue();
            limiter.TryResend("b@example.com", "10.0.0.1", out _).Should().BeTrue();
            limiter.TryResend("c@example.com", "10.0.0.1", out _).Should().BeFalse();

            limiter.TryResend("d@example.com", "10.0.0.2", out _).Should().BeTrue();
        }

        [Fact]
        public void TryResend_ConsumesEveryBudget_EvenAfterOneRefuses()
        {
            var limiter = this.Create(options =>
            {
                options.ResendMinimumInterval = TimeSpan.FromMinutes(1);
                options.ResendsPerAddress = 2;
            });

            limiter.TryResend("a@example.com", "10.0.0.1", out _).Should().BeTrue();

            // Refused by the interval. The address budget is still spent.
            limiter.TryResend("a@example.com", "10.0.0.1", out _).Should().BeFalse();

            limiter.TryResend("b@example.com", "10.0.0.1", out _).Should().BeFalse();
        }

        [Fact]
        public void TryRegistration_IsCountedPerAddress_AndSeparatelyFromResends()
        {
            var limiter = this.Create(options =>
            {
                options.ResendMinimumInterval = TimeSpan.Zero;
                options.RegistrationsPerAddress = 1;
                options.ResendsPerAddress = 1;
            });

            limiter.TryRegistration("10.0.0.1", out _).Should().BeTrue();
            limiter.TryRegistration("10.0.0.1", out _).Should().BeFalse();

            limiter.TryResend("a@example.com", "10.0.0.1", out _).Should().BeTrue();
        }

        [Fact]
        public void TryRegistration_GroupsCallersWithNoAddress_RatherThanExemptingThem()
        {
            var limiter = this.Create(options => options.RegistrationsPerAddress = 1);

            limiter.TryRegistration(null, out _).Should().BeTrue();
            limiter.TryRegistration(null, out _).Should().BeFalse();
        }

        [Fact]
        public void TryRegistration_StillRefuses_WhenTheCounterCacheIsAtCapacity()
        {
            // One tracked key. The second key cannot be stored, so it cannot be counted, so it is
            // refused. The fail-open this replaces let every cold key through forever.
            var limiter = this.Create(options =>
            {
                options.MaxTrackedKeys = 1;
                options.RegistrationsPerAddress = 100;
            });

            limiter.TryRegistration("10.0.0.1", out _).Should().BeTrue();
            limiter.TryRegistration("10.0.0.2", out var retryAfter).Should().BeFalse();
            retryAfter.Should().BePositive();
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
