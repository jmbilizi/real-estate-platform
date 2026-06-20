// <copyright file="ApiKeyDefaultsTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Helpers;
using AccountService.Routes;
using FluentAssertions;
using Xunit;

namespace AccountService.Tests.Models
{
    /// <summary>
    /// Tests for <see cref="ApiKeyDefaults"/> constants and <see cref="ApiKeyAuthenticationHandler"/> hashing.
    /// </summary>
    public class ApiKeyDefaultsTests
    {
        [Fact]
        public void AuthenticationScheme_ShouldBeApiKey()
        {
            ApiKeyDefaults.AuthenticationScheme.Should().Be("ApiKey");
        }

        [Fact]
        public void HeaderName_ShouldBeXApiKey()
        {
            ApiKeyDefaults.HeaderName.Should().Be("X-Api-Key");
        }

        [Fact]
        public void HashKey_ShouldReturnConsistentSha256Hex()
        {
            var hash1 = ApiKeys.HashKey("rep_testkey123");
            var hash2 = ApiKeys.HashKey("rep_testkey123");

            hash1.Should().Be(hash2);
            hash1.Should().HaveLength(64); // SHA-256 = 32 bytes = 64 hex chars
            hash1.Should().MatchRegex("^[0-9a-f]+$"); // lowercase hex
        }

        [Fact]
        public void HashKey_DifferentKeys_ShouldProduceDifferentHashes()
        {
            var hash1 = ApiKeys.HashKey("rep_keyA");
            var hash2 = ApiKeys.HashKey("rep_keyB");

            hash1.Should().NotBe(hash2);
        }

        [Fact]
        public void HashKey_ShouldNotContainRawKeyMaterial()
        {
            var raw = "rep_mysecretkey99";
            var hash = ApiKeys.HashKey(raw);

            hash.Should().NotContain(raw);
            hash.Should().NotContain("mysecret");
        }
    }
}
