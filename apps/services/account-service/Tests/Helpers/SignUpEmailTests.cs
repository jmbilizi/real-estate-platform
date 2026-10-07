// <copyright file="SignUpEmailTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Helpers;
using FluentAssertions;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>Unit tests for <see cref="SignUpEmail"/>.</summary>
    public class SignUpEmailTests
    {
        [Theory]
        [InlineData("person@example.com", "PERSON@EXAMPLE.COM")]
        [InlineData("  Person@Example.COM  ", "PERSON@EXAMPLE.COM")]
        [InlineData("first.last+tag@example.com", "FIRST.LAST+TAG@EXAMPLE.COM")]
        public void TryNormalize_TrimsAndFoldsCase_AndKeepsDotsAndPlusTags(string input, string key)
        {
            ArgumentNullException.ThrowIfNull(input);
            SignUpEmail.TryNormalize(input, out var actual, out var entered).Should().BeTrue();

            actual.Should().Be(key);
            entered.Should().Be(input.Trim());
        }

        [Fact]
        public void TryNormalize_KeepsTwoSpellingsApart()
        {
            SignUpEmail.TryNormalize("a.b@gmail.com", out var dotted, out _);
            SignUpEmail.TryNormalize("ab@gmail.com", out var plain, out _);
            SignUpEmail.TryNormalize("ab+x@gmail.com", out var tagged, out _);

            new[] { dotted, plain, tagged }.Distinct().Should().HaveCount(3);
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("   ")]
        [InlineData("nope")]
        [InlineData("a@b")]
        [InlineData("a@@example.com")]
        [InlineData("a b@example.com")]
        [InlineData("Name <a@example.com>")]
        [InlineData("a@example.com, b@example.com")]
        [InlineData("a@.example.com")]
        [InlineData("a@example.com.")]
        [InlineData("@example.com")]
        [InlineData("a@")]
        public void TryNormalize_RefusesABadAddress(string? input)
        {
            SignUpEmail.TryNormalize(input, out _, out _).Should().BeFalse();
        }

        [Fact]
        public void TryNormalize_RefusesAnAddressOverTheRfcLimit()
        {
            SignUpEmail.TryNormalize(new string('a', 321) + "@example.com", out _, out _).Should().BeFalse();
        }
    }
}
