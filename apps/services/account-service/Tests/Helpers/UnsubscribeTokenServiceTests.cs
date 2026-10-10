// <copyright file="UnsubscribeTokenServiceTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Helpers;
using FluentAssertions;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>Tests for <see cref="UnsubscribeTokenService"/> (#694).</summary>
    public class UnsubscribeTokenServiceTests
    {
        private const string KeyA = "unit-test-unsubscribe-key-a-0123456789-abcdef";
        private const string KeyB = "unit-test-unsubscribe-key-b-0123456789-abcdef";

        [Fact]
        public void RoundTrip_ReturnsTheAccountAndCategory()
        {
            var service = Service(KeyA);
            var token = service.Create("acct-1", "non_transactional");

            service.TryValidate(token, out var account, out var category).Should().BeTrue();
            account.Should().Be("acct-1");
            category.Should().Be("non_transactional");
        }

        [Fact]
        public void ATokenFromAnotherKey_IsRefused()
        {
            var token = Service(KeyA).Create("acct-1", "non_transactional");
            Service(KeyB).TryValidate(token, out _, out _).Should().BeFalse();
        }

        [Fact]
        public void WithNoKey_NoTokenIsSigned_AndNoneValidates()
        {
            var none = Service(string.Empty);
            none.Create("acct-1", "non_transactional").Should().BeNull();
            none.TryValidate(Service(KeyA).Create("acct-1", "non_transactional"), out _, out _).Should().BeFalse();
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("x")]
        [InlineData("a.b.c")]
        [InlineData("!!!.???")]
        public void MalformedTokens_AreRefused(string? token)
        {
            Service(KeyA).TryValidate(token, out _, out _).Should().BeFalse();
        }

        private static UnsubscribeTokenService Service(string key) =>
            new(Options.Create(new UnsubscribeOptions { HmacKey = key }));
    }
}
