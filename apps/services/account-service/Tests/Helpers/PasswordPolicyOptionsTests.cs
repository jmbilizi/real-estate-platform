// <copyright file="PasswordPolicyOptionsTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using FluentAssertions;
using Xunit;

#pragma warning disable CA1054 // InlineData cannot carry a Uri.

namespace AccountService.Tests.Helpers
{
    /// <summary>Unit tests for <see cref="PasswordPolicyOptions"/> (#654).</summary>
    public class PasswordPolicyOptionsTests
    {
        [Fact]
        public void Defaults_AreValid_AndFollowNist()
        {
            var options = new PasswordPolicyOptions();

            options.Validate().Should().BeNull();
            options.MinLength.Should().Be(15);
            options.MaxLength.Should().Be(128);
        }

        [Theory]
        [InlineData(0, 128)]
        [InlineData(15, 14)]
        [InlineData(15, 129)]
        public void BadLengths_AreRefused(int min, int max)
        {
            new PasswordPolicyOptions { MinLength = min, MaxLength = max }.Validate().Should().NotBeNull();
        }

        [Theory]
        [InlineData("http://api.pwnedpasswords.com/")]
        [InlineData("https://proxy.example/hibp")]
        public void ABreachUrlThatIsNotHttpsWithATrailingSlash_IsRefused(string url)
        {
            new PasswordPolicyOptions { BreachCheckBaseUrl = new Uri(url) }.Validate().Should().NotBeNull();
        }

        [Fact]
        public void ANonPositiveTimeout_IsRefused()
        {
            new PasswordPolicyOptions { BreachCheckTimeout = TimeSpan.Zero }.Validate().Should().NotBeNull();
        }
    }
}
