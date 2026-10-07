// <copyright file="DeletedAccountSignInTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Data;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// A soft-deleted account must not sign in on any path, and the refusal must look the same as a
    /// wrong password or an unknown address (#152). Tests set <c>DeletedAt</c> directly, without
    /// rotating the security stamp, so they prove the sign-in layer refuses it on its own.
    /// </summary>
    public class DeletedAccountSignInTests
    {
        private const string Password = "Test1234!@#Abcd";

        [Fact]
        public async Task Login_LiveAccount_StillSignsIn()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var email = NewEmail("live");
            await RegisterAsync(client, email);

            using var response = await LoginAsync(client, email, Password);

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await ReadAsync(response)).Should().Contain("accessToken");
        }

        [Fact]
        public async Task Login_SoftDeletedAccount_IssuesNoTokenAndNoCookie()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var email = NewEmail("deleted-bearer");
            await RegisterAsync(client, email);
            await SoftDeleteAsync(factory, email);

            using var response = await LoginAsync(client, email, Password);
            using var cookieResponse = await LoginAsync(client, email, Password, useCookies: true);

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await ReadAsync(response)).Should().NotContain("accessToken").And.NotContain("refreshToken");
            cookieResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            cookieResponse.Headers.Contains("Set-Cookie").Should().BeFalse();
        }

        [Fact]
        public async Task Login_SoftDeletedAccount_LooksLikeWrongPasswordAndUnknownAddress()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var email = NewEmail("deleted-parity");
            await RegisterAsync(client, email);
            await SoftDeleteAsync(factory, email);

            using var deleted = await LoginAsync(client, email, Password);
            using var unknown = await LoginAsync(client, NewEmail("never-registered"), Password);
            var live = NewEmail("wrong-password");
            await RegisterAsync(client, live);
            using var wrongPassword = await LoginAsync(client, live, "Wrong1234!@#Abc");

            var deletedBody = await DetailAsync(deleted);
            deleted.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            unknown.StatusCode.Should().Be(deleted.StatusCode);
            wrongPassword.StatusCode.Should().Be(deleted.StatusCode);
            (await DetailAsync(unknown)).Should().Be(deletedBody);
            (await DetailAsync(wrongPassword)).Should().Be(deletedBody);
        }

        [Fact]
        public async Task Refresh_SoftDeletedAccount_IsRefused_EvenWithoutStampRotation()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var email = NewEmail("deleted-refresh");
            await RegisterAsync(client, email);
            using var login = await LoginAsync(client, email, Password);
            var refreshToken = JsonDocument.Parse(await ReadAsync(login))
                .RootElement.GetProperty("refreshToken").GetString();

            using var before = await client.PostAsJsonAsync("/account/refresh", new { refreshToken });
            before.StatusCode.Should().Be(HttpStatusCode.OK);

            await SoftDeleteAsync(factory, email);

            using var after = await client.PostAsJsonAsync("/account/refresh", new { refreshToken });
            after.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task DeleteProfile_ThenRefreshAndLogin_AreBothRefused()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var email = NewEmail("deleted-endpoint");
            await RegisterAsync(client, email);
            using var login = await LoginAsync(client, email, Password);
            var payload = JsonDocument.Parse(await ReadAsync(login)).RootElement;
            var accessToken = payload.GetProperty("accessToken").GetString();
            var refreshToken = payload.GetProperty("refreshToken").GetString();

            using var delete = new HttpRequestMessage(HttpMethod.Delete, "/account/profile");
            delete.Headers.Authorization = new("Bearer", accessToken);
            using var deleted = await client.SendAsync(delete);
            deleted.StatusCode.Should().Be(HttpStatusCode.NoContent);

            using var refresh = await client.PostAsJsonAsync("/account/refresh", new { refreshToken });
            using var relogin = await LoginAsync(client, email, Password);

            refresh.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            relogin.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task ConfirmEmail_SoftDeletedAccount_FailsLikeAnyBadLink()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var email = NewEmail("deleted-confirm");
            await RegisterAsync(client, email);
            var query = new Uri(factory.ConfirmationLinks.Last(m => m.Email == email).Credential).Query;
            await SoftDeleteAsync(factory, email);

            using var response = await client.GetAsync("/account/confirmEmail" + query);

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            using var scope = factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await users.FindByEmailAsync(email);
            user!.EmailConfirmed.Should().BeFalse();
        }

        [Fact]
        public async Task Login_SoftDeletedAccount_IsRefused_WhenConfirmationIsRequiredToo()
        {
            using var factory = new AccountRecoveryFactory(options => options.RequireConfirmedEmail = true);
            using var client = factory.CreateClient();
            var email = NewEmail("deleted-required");
            await RegisterAsync(client, email);
            using var confirm = await client.GetAsync(
                "/account/confirmEmail" + new Uri(factory.ConfirmationLinks.Last(m => m.Email == email).Credential).Query);
            confirm.StatusCode.Should().Be(HttpStatusCode.OK);
            await SoftDeleteAsync(factory, email);

            using var response = await LoginAsync(client, email, Password);

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        private static string NewEmail(string tag) => $"{tag}-{Guid.NewGuid():N}@example.com";

        private static async Task RegisterAsync(HttpClient client, string email)
        {
            using var response = await client.PostAsJsonAsync("/account/register", new { email, password = Password });
            response.EnsureSuccessStatusCode();
        }

        private static Task<HttpResponseMessage> LoginAsync(HttpClient client, string email, string password, bool useCookies = false) =>
            client.PostAsJsonAsync(useCookies ? "/account/login?useCookies=true" : "/account/login", new { email, password });

        private static async Task<string> ReadAsync(HttpResponseMessage response) =>
            await response.Content.ReadAsStringAsync();

        private static async Task<string?> DetailAsync(HttpResponseMessage response) =>
            JsonDocument.Parse(await ReadAsync(response)).RootElement.GetProperty("detail").GetString();

        private static async Task SoftDeleteAsync(AccountRecoveryFactory factory, string email)
        {
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
            var user = db.Users.Single(u => u.Email == email);
            user.DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
    }
}
