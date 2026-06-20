// <copyright file="AccountRevocationTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests that verify soft-deleting an account revokes any active session
    /// immediately by rotating the security stamp, so subsequent requests with the old
    /// cookie return 401 Unauthorized.
    /// </summary>
    public class AccountRevocationTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#";

        [Fact]
        public async Task DeleteProfile_RevokesActiveSession_SubsequentRequestReturnsUnauthorized()
        {
            // Arrange: register and log in
            var email = $"revoke-{Guid.NewGuid()}@example.com";
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                HandleCookies = true,
                AllowAutoRedirect = false,
            });

            await client.PostAsJsonAsync("/account/register", new { email, password = Password });
            var loginResponse = await client.PostAsJsonAsync(
                "/account/login?useCookies=true",
                new { email, password = Password });
            loginResponse.EnsureSuccessStatusCode();

            // Confirm the session is active before deletion
            var profileBefore = await client.GetAsync("/account/profile");
            profileBefore.StatusCode.Should().Be(HttpStatusCode.OK);

            // Act: soft-delete the account (security stamp is rotated server-side)
            var deleteResponse = await client.DeleteAsync("/account/profile");
            deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

            // Assert: the same cookie is now rejected — security stamp mismatch
            var profileAfter = await client.GetAsync("/account/profile");
            profileAfter.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }
    }
}
