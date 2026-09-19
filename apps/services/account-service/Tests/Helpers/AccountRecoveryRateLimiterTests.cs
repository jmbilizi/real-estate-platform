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
        public void TryResend_ReportsTheWindowOfTheFirstRefusingCounter()
        {
            var limiter = this.Create(options =>
            {
                options.ResendMinimumInterval = TimeSpan.FromSeconds(60);
                options.ResendsPerEmailPerHour = 1;
            });

            limiter.TryResend("victim@example.com", null, out _).Should().BeTrue();
            limiter.TryResend("victim@example.com", null, out var retryAfter).Should().BeFalse();

            // The interval refuses first and the hourly counter is not consulted.
            retryAfter.Should().BeGreaterThan(TimeSpan.FromSeconds(55));
            retryAfter.Should().BeLessThan(TimeSpan.FromMinutes(2));
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
        public void TryResend_StopsAtTheFirstRefusal_SoABurstCannotDrainTheDailyBudget()
        {
            var limiter = this.Create(options =>
            {
                options.ResendMinimumInterval = TimeSpan.FromMinutes(1);
                options.ResendsPerEmailPerDay = 3;
            });

            limiter.TryResend("victim@example.com", "10.0.0.1", out _).Should().BeTrue();

            // Nine more within the interval. Each is refused by the interval counter, so none of
            // them reaches the daily counter. Charging them all locked the mailbox out for 24h.
            TimeSpan retryAfter = default;
            for (var i = 0; i < 9; i++)
            {
                limiter.TryResend("victim@example.com", "10.0.0.1", out retryAfter).Should().BeFalse();
            }

            // Still the interval window. A drained daily counter would report about 24 hours.
            retryAfter.Should().BeLessThan(TimeSpan.FromMinutes(2));
        }

        [Fact]
        public void TryResend_StillChargesTheCounterThatRefused()
        {
            var limiter = this.Create(options =>
            {
                options.ResendMinimumInterval = TimeSpan.Zero;
                options.ResendsPerEmailPerHour = 1;
            });

            limiter.TryResend("a@example.com", "10.0.0.1", out _).Should().BeTrue();
            limiter.TryResend("a@example.com", "10.0.0.1", out _).Should().BeFalse();

            // Retrying past an exhausted limit is not free: the refused attempt was counted too.
            limiter.TryResend("a@example.com", "10.0.0.1", out _).Should().BeFalse();
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
        public void TryRegistration_CompactsRatherThanRefusing_WhenTheCounterCacheIsFull()
        {
            // Twenty tracked keys and sixty callers. Refusing everyone past the cap would be a
            // service-wide outage any caller could trigger on demand, so the cache makes room.
            var limiter = this.Create(options =>
            {
                options.MaxTrackedKeys = 20;
                options.RegistrationsPerAddress = 100;
            });

            for (var i = 0; i < 60; i++)
            {
                limiter.TryRegistration($"10.0.0.{i}", out _).Should().BeTrue();
            }
        }

        [Fact]
        public void Options_RefuseANonPositiveLimit_RatherThanRefusingEveryRequest()
        {
            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "/c", MaxTrackedKeys = 0 }
                .Validate().Should().Contain("MaxTrackedKeys");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "/c", ResendsPerEmailPerHour = 0 }
                .Validate().Should().Contain("ResendsPerEmailPerHour");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "/c", ConfirmationTokenLifetime = TimeSpan.Zero }
                .Validate().Should().Contain("ConfirmationTokenLifetime");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "/c" }
                .Validate().Should().BeNull();
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
