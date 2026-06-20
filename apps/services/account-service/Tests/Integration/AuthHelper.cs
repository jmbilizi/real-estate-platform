// <copyright file="AuthHelper.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net.Http.Json;

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
    }
}
