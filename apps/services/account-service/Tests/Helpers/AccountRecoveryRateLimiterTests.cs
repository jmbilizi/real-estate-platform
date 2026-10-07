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
        public void TryRedemption_CompactsRatherThanRefusing_WhenTheCounterCacheIsFull()
        {
            // Twenty tracked keys and sixty callers. Refusing everyone past the cap would be a
            // service-wide outage any caller could trigger on demand, so the cache makes room.
            var limiter = this.Create(options =>
            {
                options.MaxTrackedKeys = 20;
                options.RedemptionsPerAddress = 100;
            });

            for (var i = 0; i < 60; i++)
            {
                limiter.TryRedemption($"10.0.0.{i}", out _).Should().BeTrue();
            }
        }

        [Fact]
        public void Options_RefuseANonPositiveLimit_RatherThanRefusingEveryRequest()
        {
            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), PasswordResetPath = "/r", MaxTrackedKeys = 0 }
                .Validate().Should().Contain("MaxTrackedKeys");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), PasswordResetPath = "/r", TokenLifetime = TimeSpan.Zero }
                .Validate().Should().Contain("TokenLifetime");

            new AccountRecoveryOptions { WebBaseUrl = new Uri("https://x.example"), PasswordResetPath = "/r" }
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

        [Fact]
        public void TrySignUpSend_CountsPerEmailAcrossAddresses_AndPerAddressAcrossEmails()
        {
            var limiter = this.Create(options => options.SignUpSendsPerAddress = 3);
            var none = TimeSpan.Zero;

            limiter.TrySignUpSend("a@example.com", "10.0.0.1", none, 2, 100, out _).Should().BeTrue();
            limiter.TrySignUpSend("a@example.com", "10.0.0.2", none, 2, 100, out _).Should().BeTrue();
            limiter.TrySignUpSend("A@Example.com", "10.0.0.3", none, 2, 100, out var retry).Should().BeFalse();
            retry.Should().BePositive();

            limiter.TrySignUpSend("b@example.com", "10.0.0.9", none, 2, 100, out _).Should().BeTrue();
            limiter.TrySignUpSend("c@example.com", "10.0.0.9", none, 2, 100, out _).Should().BeTrue();
            limiter.TrySignUpSend("d@example.com", "10.0.0.9", none, 2, 100, out _).Should().BeTrue();
            limiter.TrySignUpSend("e@example.com", "10.0.0.9", none, 2, 100, out _).Should().BeFalse();
        }

        [Fact]
        public void TrySignUpSend_AnExhaustedAddress_DoesNotSpendTheEmailBudget()
        {
            var limiter = this.Create(options => options.SignUpSendsPerAddress = 1);
            var none = TimeSpan.Zero;

            limiter.TrySignUpSend("x@example.com", "10.0.0.1", none, 1, 100, out _).Should().BeTrue();
            limiter.TrySignUpSend("victim@example.com", "10.0.0.1", none, 1, 100, out _).Should().BeFalse();

            limiter.TrySignUpSend("victim@example.com", "10.0.0.2", none, 1, 100, out _).Should().BeTrue();
        }

        [Fact]
        public void TrySignUpSend_EnforcesTheCooldown()
        {
            var limiter = this.Create(_ => { });

            limiter.TrySignUpSend("a@example.com", "10.0.0.1", TimeSpan.FromSeconds(60), 5, 10, out _).Should().BeTrue();
            limiter.TrySignUpSend("a@example.com", "10.0.0.1", TimeSpan.FromSeconds(60), 5, 10, out var retry).Should().BeFalse();

            retry.Should().BeGreaterThan(TimeSpan.Zero).And.BeLessThanOrEqualTo(TimeSpan.FromSeconds(60));
        }

        [Fact]
        public void TrySignUpVerify_CountsPerAddress()
        {
            var limiter = this.Create(options => options.SignUpVerifiesPerAddress = 2);

            limiter.TrySignUpVerify("10.0.0.1", out _).Should().BeTrue();
            limiter.TrySignUpVerify("10.0.0.1", out _).Should().BeTrue();
            limiter.TrySignUpVerify("10.0.0.1", out _).Should().BeFalse();
            limiter.TrySignUpVerify("10.0.0.2", out _).Should().BeTrue();
        }

        [Fact]
        public void TrySignUpChange_CountsTheOldEmail_AndTheNewEmail()
        {
            var limiter = this.Create(options => options.RequestsPerEmail = 2);
            var none = TimeSpan.Zero;

            limiter.TrySignUpChange("old@example.com", "n1@example.com", "10.0.0.1", none, 100, 100, out _).Should().BeTrue();
            limiter.TrySignUpChange("old@example.com", "n2@example.com", "10.0.0.1", none, 100, 100, out _).Should().BeTrue();
            limiter.TrySignUpChange("OLD@example.com", "n3@example.com", "10.0.0.1", none, 100, 100, out _).Should().BeFalse();
        }

        [Fact]
        public void TryDecoyWrongTry_CountsDownLikeTheEngine_ThenLocksForTheFullDuration()
        {
            var clock = new FakeClock();
            var limiter = this.Create(_ => { }, clock);
            var lockFor = TimeSpan.FromMinutes(15);
            var window = TimeSpan.FromDays(1);
            var left = new List<int>();

            for (var i = 0; i < 4; i++)
            {
                limiter.TryDecoyWrongTry("n@example.com", 5, lockFor, window, out var attemptsLeft, out _).Should().BeTrue();
                left.Add(attemptsLeft);
                clock.Advance(TimeSpan.FromMinutes(1));
            }

            left.Should().Equal(4, 3, 2, 1);
            limiter.IsDecoyLocked("n@example.com", out _).Should().BeFalse();

            // The fifth try locks for the full duration, however long the first four took.
            limiter.TryDecoyWrongTry("N@example.com", 5, lockFor, window, out _, out var retry).Should().BeFalse();
            retry.Should().Be(lockFor);
            limiter.IsDecoyLocked("n@EXAMPLE.com", out var lockedFor).Should().BeTrue();
            lockedFor.Should().Be(lockFor);
            limiter.IsDecoyLocked("other@example.com", out _).Should().BeFalse();

            // A try during the lock changes nothing.
            clock.Advance(TimeSpan.FromMinutes(5));
            limiter.TryDecoyWrongTry("n@example.com", 5, lockFor, window, out _, out var later).Should().BeFalse();
            later.Should().Be(TimeSpan.FromMinutes(10));
        }

        [Fact]
        public void TryDecoyWrongTry_AfterTheLockEnds_TheCountStartsAgain()
        {
            var clock = new FakeClock();
            var limiter = this.Create(_ => { }, clock);
            var lockFor = TimeSpan.FromMinutes(15);
            var window = TimeSpan.FromDays(1);
            for (var i = 0; i < 5; i++)
            {
                limiter.TryDecoyWrongTry("n@example.com", 5, lockFor, window, out _, out _);
            }

            clock.Advance(lockFor + TimeSpan.FromSeconds(1));

            limiter.IsDecoyLocked("n@example.com", out _).Should().BeFalse();
            limiter.TryDecoyWrongTry("n@example.com", 5, lockFor, window, out var attemptsLeft, out _).Should().BeTrue();
            attemptsLeft.Should().Be(4);
        }

        [Fact]
        public void TrySignUpInvalid_CountsAgainstTheClientAddressOnly()
        {
            var limiter = this.Create(options => options.SignUpSendsPerAddress = 2);

            limiter.TrySignUpInvalid("10.0.0.1", out _).Should().BeTrue();
            limiter.TrySignUpInvalid("10.0.0.1", out _).Should().BeTrue();
            limiter.TrySignUpInvalid("10.0.0.1", out _).Should().BeFalse();
            limiter.TrySignUpInvalid("10.0.0.2", out _).Should().BeTrue();
        }

        private AccountRecoveryRateLimiter Create(Action<AccountRecoveryOptions> configure, TimeProvider? clock = null)
        {
            var options = new AccountRecoveryOptions();
            configure(options);

            var limiter = new AccountRecoveryRateLimiter(Options.Create(options), clock ?? TimeProvider.System);
            this.limiters.Add(limiter);
            return limiter;
        }
    }
}
