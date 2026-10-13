// <copyright file="PasswordPolicyValidatorTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>Unit tests for <see cref="PasswordPolicyValidator"/> (#819).</summary>
    public class PasswordPolicyValidatorTests
    {
        private readonly FakePwnedPasswordsClient breaches = new();

        [Theory]
        [InlineData("Abcde1!x")]
        [InlineData("Abcdefg1!234567")]
        [InlineData("abcdefghijklmno")]
        [InlineData("ABCDEFGHIJKLMNO")]
        [InlineData("123456789012345")]
        [InlineData("correct horse battery")]
        public async Task ValidPasswords_Pass(string password)
        {
            (await this.ValidateAsync(password)).Succeeded.Should().BeTrue();
        }

        [Theory]
        [InlineData("", "too_short")]
        [InlineData("Ab1!xyz", "too_short")]
        [InlineData("abcdefg", "too_short")]
        public async Task UnderTheMinimum_IsTooShort(string password, string code)
        {
            CodesOf(await this.ValidateAsync(password)).Should().Equal(code);
        }

        [Fact]
        public async Task NullPassword_IsTooShort()
        {
            CodesOf(await this.ValidateAsync(null)).Should().Equal("too_short");
        }

        [Theory]
        [InlineData("abcdefgh", new[] { "missing_upper", "missing_digit", "missing_symbol" })]
        [InlineData("ABCDEFGH", new[] { "missing_lower", "missing_digit", "missing_symbol" })]
        [InlineData("Abcdefgh", new[] { "missing_digit", "missing_symbol" })]
        [InlineData("Abcdefg1", new[] { "missing_symbol" })]
        [InlineData("Abcdefg!", new[] { "missing_digit" })]
        [InlineData("abcdef1!", new[] { "missing_upper" })]
        [InlineData("ABCDEF1!", new[] { "missing_lower" })]
        [InlineData("Abcdefghijklmn", new[] { "missing_digit", "missing_symbol" })]
        public async Task BetweenTheLimits_NeedsEveryClass(string password, string[] codes)
        {
            CodesOf(await this.ValidateAsync(password)).Should().Equal(codes);
        }

        [Fact]
        public async Task TheEdges_SevenFails_EightWithClassesPasses_FourteenWithoutClassesFails_FifteenPasses()
        {
            (await this.ValidateAsync("Abc1!ef")).Succeeded.Should().BeFalse();
            (await this.ValidateAsync("Abc1!efg")).Succeeded.Should().BeTrue();
            (await this.ValidateAsync("abcdefghijklmn")).Succeeded.Should().BeFalse();
            (await this.ValidateAsync("abcdefghijklmno")).Succeeded.Should().BeTrue();
        }

        [Fact]
        public async Task OverTheMaximum_IsTooLong()
        {
            CodesOf(await this.ValidateAsync(new string('a', 129))).Should().Equal("too_long");
            (await this.ValidateAsync(new string('a', 128))).Succeeded.Should().BeTrue();
        }

        [Fact]
        public async Task ABreachedPassword_FailsInBothBranches()
        {
            this.breaches.Breach("Abc1!efg");
            this.breaches.Breach("abcdefghijklmno");

            CodesOf(await this.ValidateAsync("Abc1!efg")).Should().Equal("breached");
            CodesOf(await this.ValidateAsync("abcdefghijklmno")).Should().Equal("breached");
        }

        [Fact]
        public async Task ARuleFailure_SkipsTheBreachCheck()
        {
            await this.ValidateAsync("abcdefgh");

            this.breaches.Calls.Should().Be(0);
        }

        private static string[] CodesOf(IdentityResult result) => result.Errors.Select(e => e.Code).ToArray();

        private async Task<IdentityResult> ValidateAsync(string? password)
        {
            var validator = new PasswordPolicyValidator(Options.Create(new PasswordPolicyOptions()), this.breaches);
            return await validator.ValidateAsync(null!, new ApplicationUser(), password);
        }
    }
}
