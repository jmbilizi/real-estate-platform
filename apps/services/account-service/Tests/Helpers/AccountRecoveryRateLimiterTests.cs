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
                options.ResendMinimumInterval = TimeSpan.Zero;
                options.ResendsPerEmailPerHour = 1;
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
        public void TryRegistration_IsCountedPerAddress_AndSeparatelyFromRequests()
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
            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "/c", PasswordResetPath = "/r", MaxTrackedKeys = 0 }
                .Validate().Should().Contain("MaxTrackedKeys");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "/c", PasswordResetPath = "/r", ResendsPerEmailPerHour = 0 }
                .Validate().Should().Contain("ResendsPerEmailPerHour");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "/c", PasswordResetPath = "/r", ConfirmationTokenLifetime = TimeSpan.Zero }
                .Validate().Should().Contain("ConfirmationTokenLifetime");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "/c", PasswordResetPath = "/r", TokenLifetime = TimeSpan.Zero }
                .Validate().Should().Contain("TokenLifetime");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), ConfirmationPath = "/c", PasswordResetPath = "/r" }
                .Validate().Should().BeNull();
        }

        [Fact]
        public void TryRequest_StillEnforcesTheLimit_WhenTheCounterCacheIsAtCapacity()
        {
            // The counter cache is capped, and the cap is reachable on purpose: half of every key
            // is an attacker-chosen email address. What must NOT happen is that reaching the cap
            // turns the limiter off.
            //
            // This is the regression test for a real fail-open. MemoryCache with a SizeLimit does
            // not evict-then-add when it is full — it refuses to store the entry and schedules a
            // background compaction. GetOrCreate still returns the factory's value, so a cold key
            // came back with Count == 1 on every single request, forever, and the limit simply did
            // not apply. An attacker who can vary X-Real-IP can fill the cache deliberately, so
            // this was reachable, not theoretical.
            var limiter = this.Create(options =>
            {
                options.MaxTrackedKeys = 2;
                options.RequestsPerEmail = 1;
                options.RequestsPerAddress = 1000;
            });

            // One call consumes two keys (email + address), which fills the cache.
            limiter.TryRequest("resident@example.com", "10.0.0.1", out _).Should().BeTrue();

            // A resident key is still counted correctly.
            limiter.TryRequest("resident@example.com", "10.0.0.1", out _).Should().BeFalse();

            // A cold key, with the cache full, must not be unlimited. Under the bug every one of
            // these returned true.
            var refusals = 0;
            for (var attempt = 0; attempt < 10; attempt++)
            {
                if (!limiter.TryRequest("cold@example.com", "10.0.0.2", out _))
                {
                    refusals++;
                }
            }

            refusals.Should().BeGreaterThan(0, "a limit that stops applying under load is not a limit");
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
