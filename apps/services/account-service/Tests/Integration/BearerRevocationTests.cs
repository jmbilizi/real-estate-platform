// <copyright file="BearerRevocationTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Headers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// A bearer access token issued before a security-stamp rotation is rejected on its next use (#142).
    /// </summary>
    public class BearerRevocationTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#Abcd";

        [Fact]
        public async Task Bearer_IsAcceptedBeforeAnyRotation()
        {
            var (client, _, _) = await LoginAsync();

            using var profile = await client.GetAsync("/account/profile");
            profile.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task SoftDelete_RevokesBearerToken()
        {
            var (client, _, _) = await LoginAsync();

            using (var delete = await client.DeleteAsync("/account/profile"))
            {
                delete.StatusCode.Should().Be(HttpStatusCode.NoContent);
            }

            using var after = await client.GetAsync("/account/profile");
            after.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task PasswordReset_RevokesBearerToken()
        {
            var (client, email, _) = await LoginAsync();

            await RotateAsync(email, async (users, user) =>
            {
                var code = await users.GeneratePasswordResetTokenAsync(user);
                return await users.ResetPasswordAsync(user, code, "Other1234!@#Abcde");
            });

            using var after = await client.GetAsync("/account/profile");
            after.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task AdminSuspension_RevokesBearerToken()
        {
            // No suspension endpoint exists yet. Suspension rotates the stamp through UserManager.
            var (client, email, _) = await LoginAsync();

            await RotateAsync(email, (users, user) => users.UpdateSecurityStampAsync(user));

            using var after = await client.GetAsync("/account/profile");
            after.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task RevokedBearer_FailsIntrospection()
        {
            var (_, email, token) = await LoginAsync();

            await RotateAsync(email, (users, user) => users.UpdateSecurityStampAsync(user));

            using var anonymous = factory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Post, "/internal/account/introspect");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await anonymous.SendAsync(request);

            (await response.Content.ReadAsStringAsync()).Should().Contain("\"isRevoked\":true");
        }

        private async Task<(HttpClient Client, string Email, string Token)> LoginAsync()
        {
            var email = $"bearer-revoke-{Guid.NewGuid()}@example.com";
            var token = await AuthHelper.CreateBearerTokenAsync(factory, email, Password);
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return (client, email, token);
        }

        private async Task RotateAsync(
            string email,
            Func<UserManager<ApplicationUser>, ApplicationUser, Task<IdentityResult>> rotate)
        {
            using var scope = factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await users.FindByEmailAsync(email);
            var result = await rotate(users, user!);
            result.Succeeded.Should().BeTrue();
        }
    }
}
