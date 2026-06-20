// <copyright file="ProfileEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for the profile endpoints (GET / PUT / DELETE).
    /// </summary>
    public class ProfileEndpointTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#";

        [Fact]
        public async Task GetProfile_ReturnsUnauthorized_WhenNotLoggedIn()
        {
            var client = factory.CreateClient();
            var response = await client.GetAsync("/account/profile");
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task GetProfile_ReturnsOk_WhenAuthenticated()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"get-profile-{Guid.NewGuid()}@example.com", Password);

            var response = await client.GetAsync("/account/profile");
            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task GetProfile_ContainsEmailField_WhenAuthenticated()
        {
            var email = $"get-email-{Guid.NewGuid()}@example.com";
            var client = await AuthHelper.CreateAuthenticatedClientAsync(factory, email, Password);

            var response = await client.GetAsync("/account/profile");
            var body = await response.Content.ReadAsStringAsync();
            body.Should().Contain(email);
        }

        [Fact]
        public async Task PutProfile_ReturnsNoContent_WhenAuthenticated()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"put-profile-{Guid.NewGuid()}@example.com", Password);

            var response = await client.PutAsJsonAsync("/account/profile", new
            {
                firstName = "Jane",
                lastName = "Doe",
            });

            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        [Fact]
        public async Task PutProfile_UpdatesFields_WhenAuthenticated()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"put-update-{Guid.NewGuid()}@example.com", Password);

            await client.PutAsJsonAsync("/account/profile", new
            {
                firstName = "UpdatedFirst",
                bio = "My bio text",
            });

            var response = await client.GetAsync("/account/profile");
            var body = await response.Content.ReadAsStringAsync();
            body.Should().Contain("UpdatedFirst");
            body.Should().Contain("My bio text");
        }

        [Fact]
        public async Task PutProfile_ReturnsUnauthorized_WhenNotLoggedIn()
        {
            var client = factory.CreateClient();
            var response = await client.PutAsJsonAsync("/account/profile", new { firstName = "X" });
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task DeleteProfile_ReturnsNoContent_WhenAuthenticated()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"delete-profile-{Guid.NewGuid()}@example.com", Password);

            var response = await client.DeleteAsync("/account/profile");
            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        [Fact]
        public async Task DeleteProfile_RevokesSession_SubsequentRequestReturnsUnauthorized()
        {
            // After soft-delete, the security stamp is rotated — the existing cookie is
            // immediately invalid, so the server returns 401 before ever reaching the
            // soft-delete guard that would otherwise return 404.
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"delete-twice-{Guid.NewGuid()}@example.com", Password);

            await client.DeleteAsync("/account/profile");

            var response = await client.GetAsync("/account/profile");
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task DeleteProfile_ReturnsUnauthorized_WhenNotLoggedIn()
        {
            var client = factory.CreateClient();
            var response = await client.DeleteAsync("/account/profile");
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }
    }
}
