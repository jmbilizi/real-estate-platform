// <copyright file="GoogleSignInEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using AccountService.Configuration;
using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// <c>POST /account/login/google</c> (#1049). The token validator is faked: a test names the
    /// identity a token resolves to, so these tests cover the account rules, not Google's keys.
    /// </summary>
    public class GoogleSignInEndpointTests
    {
        private const string ClientId = "test-client.apps.googleusercontent.com";

        [Fact]
        public async Task NewAddress_CreatesAConfirmedAccount_AndSignsIn()
        {
            using var factory = new GoogleFactory(ClientId);
            using var client = factory.CreateClient();
            var email = NewEmail("new");
            factory.Tokens["good"] = new GoogleIdentity("sub-new", email, true);

            using var response = await PostAsync(client, "good");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await response.Content.ReadAsStringAsync()).Should().Contain("accessToken");
            using var scope = factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await users.FindByEmailAsync(email);
            user.Should().NotBeNull();
            user!.EmailConfirmed.Should().BeTrue();
            (await users.IsInRoleAsync(user, Roles.User)).Should().BeTrue();
            (await users.GetLoginsAsync(user)).Should().ContainSingle(l => l.LoginProvider == "Google" && l.ProviderKey == "sub-new");
        }

        [Fact]
        public async Task CookieSession_IsIssuedWhenUseCookiesIsSet()
        {
            using var factory = new GoogleFactory(ClientId);
            using var client = factory.CreateClient();
            factory.Tokens["good"] = new GoogleIdentity("sub-cookie", NewEmail("cookie"), true);

            using var response = await PostAsync(client, "good", "?useCookies=true");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            response.Headers.Contains("Set-Cookie").Should().BeTrue();
        }

        [Fact]
        public async Task ExistingAddress_SignsInToThatAccount_AndLinksGoogle()
        {
            using var factory = new GoogleFactory(ClientId);
            using var client = factory.CreateClient();
            var email = NewEmail("existing");
            await AuthHelper.SeedUserAsync(factory, email, "Test1234!@#Abcd");
            var before = await CountUsersAsync(factory);
            factory.Tokens["good"] = new GoogleIdentity("sub-existing", email, true);

            using var first = await PostAsync(client, "good");
            using var second = await PostAsync(client, "good");

            first.StatusCode.Should().Be(HttpStatusCode.OK);
            second.StatusCode.Should().Be(HttpStatusCode.OK);
            (await CountUsersAsync(factory)).Should().Be(before);
            using var scope = factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await users.FindByEmailAsync(email);
            (await users.GetLoginsAsync(user!)).Should().ContainSingle(l => l.ProviderKey == "sub-existing");
        }

        [Fact]
        public async Task LinkedSubject_MatchesBySubject_WhenTheAddressDiffers()
        {
            using var factory = new GoogleFactory(ClientId);
            using var client = factory.CreateClient();
            var email = NewEmail("linked");
            await AuthHelper.SeedUserAsync(factory, email, "Test1234!@#Abcd");
            factory.Tokens["first"] = new GoogleIdentity("sub-linked", email, true);
            factory.Tokens["second"] = new GoogleIdentity("sub-linked", NewEmail("other"), true);
            (await PostAsync(client, "first")).StatusCode.Should().Be(HttpStatusCode.OK);
            var before = await CountUsersAsync(factory);

            using var response = await PostAsync(client, "second");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await CountUsersAsync(factory)).Should().Be(before);
        }

        [Fact]
        public async Task UnverifiedEmail_IsRefused_AndCreatesNoAccount()
        {
            using var factory = new GoogleFactory(ClientId);
            using var client = factory.CreateClient();
            var before = await CountUsersAsync(factory);
            factory.Tokens["unverified"] = new GoogleIdentity("sub-unverified", NewEmail("unverified"), false);

            using var response = await PostAsync(client, "unverified");

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await response.Content.ReadAsStringAsync()).Should().NotContain("accessToken").And.Contain("email_not_verified");
            (await CountUsersAsync(factory)).Should().Be(before);
        }

        [Theory]
        [InlineData("bad-audience")]
        [InlineData("expired")]
        [InlineData("garbage")]
        public async Task InvalidToken_IsRefused_AndCreatesNoAccount(string credential)
        {
            // The fake knows no such token, as the real validator knows none with a wrong
            // audience, an expired lifetime or a bad signature: all of them resolve to null.
            using var factory = new GoogleFactory(ClientId);
            using var client = factory.CreateClient();
            var before = await CountUsersAsync(factory);

            using var response = await PostAsync(client, credential);

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await response.Content.ReadAsStringAsync()).Should().NotContain("accessToken");
            (await CountUsersAsync(factory)).Should().Be(before);
        }

        [Fact]
        public async Task Validator_ReceivesTheConfiguredClientIdAsTheAudience()
        {
            using var factory = new GoogleFactory(ClientId);
            using var client = factory.CreateClient();

            using var response = await PostAsync(client, "anything");

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            factory.AudiencesSeen.Should().Equal(ClientId);
        }

        [Fact]
        public async Task MissingCredential_IsRefused()
        {
            using var factory = new GoogleFactory(ClientId);
            using var client = factory.CreateClient();

            using var response = await client.PostAsJsonAsync("/account/login/google", new { });

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task SoftDeletedAccount_IsRefused_AndNotRecreated()
        {
            using var factory = new GoogleFactory(ClientId);
            using var client = factory.CreateClient();
            var email = NewEmail("deleted");
            await AuthHelper.SeedUserAsync(factory, email, "Test1234!@#Abcd");
            await SoftDeleteAsync(factory, email);
            var before = await CountUsersAsync(factory);
            factory.Tokens["good"] = new GoogleIdentity("sub-deleted", email, true);

            using var response = await PostAsync(client, "good");
            using var cookie = await PostAsync(client, "good", "?useCookies=true");

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await response.Content.ReadAsStringAsync()).Should().NotContain("accessToken");
            cookie.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            cookie.Headers.Contains("Set-Cookie").Should().BeFalse();
            (await CountUsersAsync(factory)).Should().Be(before);
        }

        [Fact]
        public async Task SoftDeletedAccount_WithALinkedGoogleLogin_IsRefused()
        {
            using var factory = new GoogleFactory(ClientId);
            using var client = factory.CreateClient();
            var email = NewEmail("deleted-linked");
            await AuthHelper.SeedUserAsync(factory, email, "Test1234!@#Abcd");
            factory.Tokens["good"] = new GoogleIdentity("sub-deleted-linked", email, true);
            (await PostAsync(client, "good")).StatusCode.Should().Be(HttpStatusCode.OK);
            await SoftDeleteAsync(factory, email);

            using var response = await PostAsync(client, "good");

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await response.Content.ReadAsStringAsync()).Should().NotContain("accessToken");
        }

        [Fact]
        public async Task LockedOutAccount_IsRefused()
        {
            using var factory = new GoogleFactory(ClientId);
            using var client = factory.CreateClient();
            var email = NewEmail("locked");
            await AuthHelper.SeedUserAsync(factory, email, "Test1234!@#Abcd");
            using (var scope = factory.Services.CreateScope())
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
                var user = await users.FindByEmailAsync(email);
                await users.SetLockoutEnabledAsync(user!, true);
                await users.SetLockoutEndDateAsync(user!, DateTimeOffset.UtcNow.AddHours(1));
            }

            factory.Tokens["good"] = new GoogleIdentity("sub-locked", email, true);

            using var response = await PostAsync(client, "good");

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await response.Content.ReadAsStringAsync()).Should().NotContain("accessToken");
        }

        [Fact]
        public async Task NoClientId_Answers503_AndStartsUp()
        {
            using var factory = new GoogleFactory(string.Empty);
            using var client = factory.CreateClient();
            factory.Tokens["good"] = new GoogleIdentity("sub-off", NewEmail("off"), true);

            using var response = await PostAsync(client, "good");

            response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
            factory.AudiencesSeen.Should().BeEmpty();
        }

        [Fact]
        public async Task PlaceholderClientId_Answers503()
        {
            using var factory = new GoogleFactory(GoogleSignInOptions.Placeholder);
            using var client = factory.CreateClient();

            using var response = await PostAsync(client, "good");

            response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        }

        private static string NewEmail(string tag) => $"{tag}-{Guid.NewGuid():N}@example.com";

        private static Task<HttpResponseMessage> PostAsync(HttpClient client, string credential, string query = "") =>
            client.PostAsJsonAsync("/account/login/google" + query, new { credential });

        private static async Task<int> CountUsersAsync(AccountServiceFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().Users.CountAsync();
        }

        private static async Task SoftDeleteAsync(AccountServiceFactory factory, string email)
        {
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
            var user = db.Users.Single(u => u.Email == email);
            user.DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        private sealed class GoogleFactory(string clientId) : AccountServiceFactory
        {
            /// <summary>Gets the identity each known token resolves to. An unknown token is invalid.</summary>
            internal Dictionary<string, GoogleIdentity> Tokens { get; } = new(StringComparer.Ordinal);

            /// <summary>Gets the audiences the validator was asked for.</summary>
            internal List<string> AudiencesSeen { get; } = new();

            protected override void ConfigureWebHost(IWebHostBuilder builder)
            {
                base.ConfigureWebHost(builder);
                builder.ConfigureServices(services =>
                {
                    services.Configure<GoogleSignInOptions>(options => options.ClientId = clientId);
                    services.AddSingleton<IGoogleIdTokenValidator>(new FakeValidator(this));
                });
            }

            private sealed class FakeValidator(GoogleFactory owner) : IGoogleIdTokenValidator
            {
                public Task<GoogleIdentity?> ValidateAsync(string idToken, string audience, CancellationToken cancellationToken = default)
                {
                    owner.AudiencesSeen.Add(audience);
                    return Task.FromResult(owner.Tokens.GetValueOrDefault(idToken));
                }
            }
        }
    }
}
