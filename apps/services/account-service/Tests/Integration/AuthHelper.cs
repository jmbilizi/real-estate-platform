// <copyright file="AuthHelper.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net.Http.Json;
using System.Text.Json;

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Helper to register and log in a test user via the Identity API endpoints,
    /// returning an <see cref="HttpClient"/> with the session cookie set.
    /// </summary>
    internal static class AuthHelper
    {
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

            // Register — each caller uses a unique email so this always succeeds.
            var registerResponse = await client.PostAsJsonAsync("/account/register", new
            {
                email,
                password,
            });
            registerResponse.EnsureSuccessStatusCode();

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

            var registerResponse = await client.PostAsJsonAsync("/account/register", new
            {
                email,
                password,
            });
            registerResponse.EnsureSuccessStatusCode();

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

            var registerResponse = await client.PostAsJsonAsync("/account/register", new
            {
                email,
                password,
            });
            registerResponse.EnsureSuccessStatusCode();

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
