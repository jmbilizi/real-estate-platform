// <copyright file="PasswordResetRateLimiterTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Helpers;
using FluentAssertions;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Unit tests for <see cref="PasswordResetRateLimiter"/>.
    /// </summary>
    public class PasswordResetRateLimiterTests : IDisposable
    {
        private readonly List<MemoryCache> caches = new();

        /// <inheritdoc/>
        public void Dispose()
        {
            foreach (var cache in this.caches)
            {
                cache.Dispose();
            }

            this.caches.Clear();
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

        private PasswordResetRateLimiter Create(Action<PasswordResetOptions> configure)
        {
            var options = new PasswordResetOptions();
            configure(options);

            var cache = new MemoryCache(new MemoryCacheOptions());
            this.caches.Add(cache);

            return new PasswordResetRateLimiter(cache, Options.Create(options), TimeProvider.System);
        }
    }
}
