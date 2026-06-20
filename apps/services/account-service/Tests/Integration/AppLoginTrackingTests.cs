// <copyright file="AppLoginTrackingTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>
using System.Net.Http.Json;
using AccountService.Data;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests that verify <see cref="AccountService.Models.AppSignInManager"/> correctly
    /// creates and updates <c>UserApp</c> rows on login, and that unknown app identifiers
    /// are silently ignored.
    /// </summary>
    public class AppLoginTrackingTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#";

        [Fact]
        public async Task Login_WithAllowedAppIdHeader_CreatesUserAppRecord()
        {
            // Arrange: register a new user
            var email = $"track-allowed-{Guid.NewGuid()}@example.com";
            await RegisterAsync(email);

            // Act: log in with a recognised X-App-Id header
            var loginClient = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                HandleCookies = true,
                AllowAutoRedirect = false,
            });
            loginClient.DefaultRequestHeaders.Add("X-App-Id", "cribstop");

            var loginResponse = await loginClient.PostAsJsonAsync(
                "/account/login?useCookies=true",
                new { email, password = Password });
            loginResponse.EnsureSuccessStatusCode();

            // Assert: a UserApp row was upserted for this user + app
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();

            var user = await userManager.FindByEmailAsync(email);
            user.Should().NotBeNull();

            var userApp = await db.UserApps
                .FirstOrDefaultAsync(ua => ua.UserId == user!.Id && ua.AppId == "cribstop");
            userApp.Should().NotBeNull();
        }

        [Fact]
        public async Task Login_WithUnknownAppIdHeader_DoesNotCreateUserAppRecord()
        {
            // Arrange
            var email = $"track-unknown-{Guid.NewGuid()}@example.com";
            await RegisterAsync(email);

            // Act: log in with an AppId not in AllowedApps
            var loginClient = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                HandleCookies = true,
                AllowAutoRedirect = false,
            });
            loginClient.DefaultRequestHeaders.Add("X-App-Id", "not-a-real-app");

            var loginResponse = await loginClient.PostAsJsonAsync(
                "/account/login?useCookies=true",
                new { email, password = Password });

            // Login itself succeeds — the unknown AppId is silently discarded
            loginResponse.EnsureSuccessStatusCode();

            // Assert: no UserApp row created
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();

            var user = await userManager.FindByEmailAsync(email);
            user.Should().NotBeNull();

            var userApp = await db.UserApps
                .FirstOrDefaultAsync(ua => ua.UserId == user!.Id && ua.AppId == "not-a-real-app");
            userApp.Should().BeNull();
        }

        [Fact]
        public async Task Login_SecondLoginWithSameApp_UpdatesLastSeenAt()
        {
            // Arrange
            var email = $"track-reseen-{Guid.NewGuid()}@example.com";
            await RegisterAsync(email);

            // First login
            var loginClient = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                HandleCookies = true,
                AllowAutoRedirect = false,
            });
            loginClient.DefaultRequestHeaders.Add("X-App-Id", "cribstop");
            await loginClient.PostAsJsonAsync(
                "/account/login?useCookies=true",
                new { email, password = Password });

            // Get FirstSeenAt
            using var scope1 = factory.Services.CreateScope();
            var db1 = scope1.ServiceProvider.GetRequiredService<AccountDbContext>();
            var userManager1 = scope1.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await userManager1.FindByEmailAsync(email);
            var first = await db1.UserApps
                .FirstOrDefaultAsync(ua => ua.UserId == user!.Id && ua.AppId == "cribstop");
            var firstSeenAt = first!.FirstSeenAt;

            // Act: second login
            var loginClient2 = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                HandleCookies = true,
                AllowAutoRedirect = false,
            });
            loginClient2.DefaultRequestHeaders.Add("X-App-Id", "cribstop");
            await loginClient2.PostAsJsonAsync(
                "/account/login?useCookies=true",
                new { email, password = Password });

            // Assert: still only one row, FirstSeenAt unchanged
            using var scope2 = factory.Services.CreateScope();
            var db2 = scope2.ServiceProvider.GetRequiredService<AccountDbContext>();
            var rows = await db2.UserApps
                .Where(ua => ua.UserId == user!.Id && ua.AppId == "cribstop")
                .ToListAsync();

            rows.Should().HaveCount(1);
            rows[0].FirstSeenAt.Should().Be(firstSeenAt);
        }

        // ── Helpers ──────────────────────────────────────────────────────────────
        private async Task RegisterAsync(string email)
        {
            var client = factory.CreateClient();
            var response = await client.PostAsJsonAsync("/account/register", new
            {
                email,
                password = Password,
            });
            response.EnsureSuccessStatusCode();
        }
    }
}
