// <copyright file="GoogleIdTokenValidatorTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Helpers;
using FluentAssertions;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// The real validator refuses a malformed token before it reaches the network. The signature,
    /// issuer, audience and expiry checks belong to <c>Google.Apis.Auth</c>.
    /// </summary>
    public class GoogleIdTokenValidatorTests
    {
        [Theory]
        [InlineData("garbage")]
        [InlineData("a.b.c")]
        [InlineData("e30.e30.e30")]
        [InlineData("not-base64!.also-not!.nope!")]
        public async Task MalformedToken_ResolvesToNull(string token)
        {
            var validator = new GoogleIdTokenValidator();

            var identity = await validator.ValidateAsync(token, "client.apps.googleusercontent.com");

            identity.Should().BeNull();
        }
    }
}
