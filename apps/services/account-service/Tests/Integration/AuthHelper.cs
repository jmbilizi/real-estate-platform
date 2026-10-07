// <copyright file="AuthHelper.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Helper to seed a confirmed test user and log in through the Identity API endpoints,
    /// returning an <see cref="HttpClient"/> with the session cookie set. The public register
    /// endpoint is retired (#657), so the user is written through the user manager.
    /// </summary>
    internal static class AuthHelper
    {
        /// <summary>Creates a confirmed account with the default role, as sign-up completion does.</summary>
        /// <param name="factory">The host.</param>
        /// <param name="email">The address. Each caller uses a unique one.</param>
        /// <param name="password">The password.</param>
        /// <returns>A task that completes when the account exists.</returns>
        internal static async Task SeedUserAsync(AccountServiceFactory factory, string email, string password)
        {
            using var scope = factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var result = await users.CreateAsync(
                new ApplicationUser { UserName = email, Email = email, EmailConfirmed = true },
                password);
            if (!result.Succeeded)
            {
                throw new InvalidOperationException("Seeding failed: " + string.Join(", ", result.Errors.Select(e => e.Code)));
            }
        }

        internal static async Task<HttpClient> CreateAuthenticatedClientAsync(
            AccountServiceFactory factory,
            string email,
            string password)
        {
            // Use a cookie-based client so the session is preserved across requests.
            var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                HandleCookies = true,
            });

            await SeedUserAsync(factory, email, password);

            // Log in using the cookie-based endpoint
            var loginResponse = await client.PostAsJsonAsync("/account/login?useCookies=true", new
            {
                email,
                password,
            });

            loginResponse.EnsureSuccessStatusCode();

            return client;
        }

        internal static async Task<string> CreateBearerTokenAsync(
            AccountServiceFactory factory,
            string email,
            string password)
        {
            var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                HandleCookies = false,
            });

            await SeedUserAsync(factory, email, password);

            var loginResponse = await client.PostAsJsonAsync("/account/login", new
            {
                email,
                password,
            });
            loginResponse.EnsureSuccessStatusCode();

            var payload = JsonDocument.Parse(await loginResponse.Content.ReadAsStringAsync());
            var accessToken = payload.RootElement.GetProperty("accessToken").GetString();
            return accessToken ?? throw new InvalidOperationException("Bearer login response did not include accessToken.");
        }

        internal static async Task<string> CreateSessionCookieHeaderAsync(
            AccountServiceFactory factory,
            string email,
            string password)
        {
            var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                HandleCookies = false,
            });

            await SeedUserAsync(factory, email, password);

            var loginResponse = await client.PostAsJsonAsync("/account/login?useCookies=true", new
            {
                email,
                password,
            });
            loginResponse.EnsureSuccessStatusCode();

            if (!loginResponse.Headers.TryGetValues("Set-Cookie", out var setCookieValues))
            {
                throw new InvalidOperationException("Cookie login response did not include Set-Cookie headers.");
            }

            var authCookie = setCookieValues
                .Select(value => value.Split(';', 2)[0])
                .FirstOrDefault(value => value.StartsWith(".AspNetCore.Identity.Application=", StringComparison.Ordinal));

            return authCookie ?? throw new InvalidOperationException("Cookie login response did not include the identity cookie.");
        }
    }
}
