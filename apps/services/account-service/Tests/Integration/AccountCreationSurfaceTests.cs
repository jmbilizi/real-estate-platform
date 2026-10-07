// <copyright file="AccountCreationSurfaceTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using AccountService.Data;
using FluentAssertions;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// The hard goal of #657: no code path creates an <c>ApplicationUser</c> without a verified
    /// code. <c>POST /account/signup/complete</c> is the only endpoint that may.
    /// </summary>
    /// <remarks>
    /// The test fails when a new endpoint appears that is not in <see cref="Surface"/>, so the author
    /// must state whether it creates accounts. The probe then calls every endpoint with a body that
    /// would satisfy a registration, and checks that no account row appears.
    /// </remarks>
    public class AccountCreationSurfaceTests
    {
        private const string SignUpComplete = "POST /account/signup/complete";

        private static readonly string[] AnyMethod = new[] { "*" };

        /// <summary>Every account-service endpoint. The value says whether it creates an account.</summary>
        private static readonly Dictionary<string, bool> Surface = new(StringComparer.Ordinal)
        {
            ["GET /account/health"] = false,
            ["GET /account/health/ready"] = false,
            ["POST /account/login"] = false,
            ["POST /account/refresh"] = false,
            ["POST /account/forgotPassword"] = false,
            ["POST /account/resetPassword"] = false,
            ["POST /account/manage/2fa"] = false,
            ["GET /account/manage/info"] = false,
            ["POST /account/manage/info"] = false,
            ["POST /account/identify"] = false,
            ["POST /account/signup/start"] = false,
            ["POST /account/signup/verify"] = false,
            ["POST /account/signup/resend"] = false,
            ["POST /account/signup/change-email"] = false,
            [SignUpComplete] = true,
            ["POST /account/password/reset/start"] = false,
            ["POST /account/password/reset/verify"] = false,
            ["POST /account/password/reset/complete"] = false,
            ["GET /account/profile"] = false,
            ["PUT /account/profile"] = false,
            ["DELETE /account/profile"] = false,
            ["GET /account/{userId}/history"] = false,
            ["GET /account/{userId}/roles"] = false,
            ["POST /account/{userId}/roles"] = false,
            ["DELETE /account/{userId}/roles/{role}"] = false,
            ["POST /account/api-keys"] = false,
            ["GET /account/api-keys"] = false,
            ["DELETE /account/api-keys/{id}"] = false,
            ["GET /account/waitlist"] = false,
            ["POST /account/waitlist"] = false,
            ["DELETE /account/waitlist/{interest}"] = false,
            ["POST /account/email/change/start"] = false,
            ["POST /account/email/change/verify"] = false,
            ["POST /account/webhooks/postmark"] = false,
            ["POST /internal/account/introspect"] = false,
            ["GET /openapi/{documentName}.json"] = false,
        };

        [Fact]
        public void EveryEndpoint_IsClassified_AndOnlySignUpCompleteCreatesAnAccount()
        {
            using var factory = new AccountServiceFactory();

            var mapped = MappedEndpoints(factory);

            var unclassified = mapped.Where(key => !Surface.ContainsKey(key)).ToList();
            unclassified.Should().BeEmpty("a new endpoint must be added to Surface, stating whether it creates an account");

            Surface.Where(entry => entry.Value).Select(entry => entry.Key)
                .Should().BeEquivalentTo([SignUpComplete]);
            Surface.Keys.Except(mapped).Should().BeEmpty("a listed endpoint is not mapped");
        }

        [Theory]
        [InlineData("POST", "/account/register")]
        [InlineData("GET", "/account/confirmEmail")]
        [InlineData("POST", "/account/resendConfirmationEmail")]
        public async Task RetiredIdentityEndpoints_AreNotMapped_AndAnswer404(string method, string path)
        {
            using var factory = new AccountServiceFactory();
            using var client = factory.CreateClient();

            MappedEndpoints(factory).Should().NotContain(key => key.EndsWith(" " + path, StringComparison.Ordinal));

            using var request = new HttpRequestMessage(new HttpMethod(method), path);
            if (method == "POST")
            {
                request.Content = JsonContent.Create(new { email = "someone@example.com", password = "Test1234!@#Abcd" });
            }

            using var response = await client.SendAsync(request);
            response.StatusCode.Should().Be(HttpStatusCode.NotFound);

            var document = await client.GetStringAsync("/openapi/v1.json");
            document.Should().NotContain(path);
        }

        [Fact]
        public async Task Probing_EveryEndpointWithARegistrationBody_CreatesNoAccount()
        {
            using var factory = new AccountServiceFactory();
            using var client = factory.CreateClient();
            var before = await CountUsersAsync(factory);

            foreach (var key in MappedEndpoints(factory).Where(key => key != SignUpComplete))
            {
                var parts = key.Split(' ', 2);
                var path = Regex.Replace(parts[1], @"\{[^}]+\}", "probe");
                using var request = new HttpRequestMessage(new HttpMethod(parts[0]), path);
                if (parts[0] is "POST" or "PUT")
                {
                    request.Content = JsonContent.Create(new
                    {
                        email = $"probe-{Guid.NewGuid()}@example.com",
                        password = "Test1234!@#Abcd",
                        newPassword = "Test1234!@#Abcd",
                        code = "000000",
                        resetCode = "000000",
                        signupProof = "x",
                        resetProof = "x",
                    });
                }

                using var response = await client.SendAsync(request);
                ((int)response.StatusCode).Should().BeLessThan(500, key);
            }

            (await CountUsersAsync(factory)).Should().Be(before);
        }

        [Fact]
        public async Task ManageInfo_RefusesANewEmail_BecauseTheConfirmationLinkIsRetired()
        {
            using var factory = new AccountServiceFactory();
            var email = $"change-{Guid.NewGuid()}@example.com";
            using var client = await AuthHelper.CreateAuthenticatedClientAsync(factory, email, "Test1234!@#Abcd");

            using var response = await client.PostAsJsonAsync("/account/manage/info", new { newEmail = $"other-{Guid.NewGuid()}@example.com" });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        private static List<string> MappedEndpoints(AccountServiceFactory factory) =>
            factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
                .OfType<RouteEndpoint>()
                .SelectMany(endpoint => (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? AnyMethod)
                    .Select(method => $"{method} {endpoint.RoutePattern.RawText}"))
                .Distinct(StringComparer.Ordinal)
                .ToList();

        private static async Task<int> CountUsersAsync(AccountServiceFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().Users.CountAsync();
        }
    }
}
