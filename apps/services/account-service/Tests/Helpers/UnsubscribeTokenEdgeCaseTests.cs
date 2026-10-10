// <copyright file="UnsubscribeTokenEdgeCaseTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Cryptography;
using System.Text;
using AccountService.Configuration;
using AccountService.Helpers;
using FluentAssertions;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>Edge cases of <see cref="UnsubscribeTokenService"/> (#694).</summary>
    public class UnsubscribeTokenEdgeCaseTests
    {
        private const string Key = "unit-test-unsubscribe-key-a-0123456789-abcdef";

        [Fact]
        public void ATamperedPayload_WithTheOriginalSignature_IsRefused()
        {
            var service = Service();
            var original = service.Create("acct-1", "non_transactional")!.Split('.');
            var other = service.Create("acct-2", "non_transactional")!.Split('.');

            service.TryValidate($"{other[0]}.{original[1]}", out _, out _).Should().BeFalse();
        }

        [Fact]
        public void ATokenOver512Characters_IsRefused()
        {
            var service = Service();
            var token = service.Create(new string('a', 600), "non_transactional")!;

            token.Length.Should().BeGreaterThan(512);
            service.TryValidate(token, out _, out _).Should().BeFalse();
        }

        [Fact]
        public void AWrongVersion_IsRefused_EvenWithAValidSignature()
        {
            var payload = Base64Url(Encoding.UTF8.GetBytes("v2|acct-1|non_transactional"));
            var signature = Base64Url(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Key), Encoding.UTF8.GetBytes($"unsubscribe|{payload}")));

            Service().TryValidate($"{payload}.{signature}", out _, out _).Should().BeFalse();
        }

        [Fact]
        public void ATrailingDot_IsRefused()
        {
            var service = Service();
            service.TryValidate(service.Create("acct-1", "non_transactional") + ".", out _, out _).Should().BeFalse();
        }

        private static string Base64Url(byte[] bytes) =>
            Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        private static UnsubscribeTokenService Service() =>
            new(Options.Create(new UnsubscribeOptions { HmacKey = Key }));
    }
}
