// <copyright file="PasswordResetEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Configuration;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for <c>POST /account/password/forgot</c> and
    /// <c>POST /account/password/reset</c>.
    /// </summary>
    /// <remarks>
    /// The security properties are the subject here, not the happy path: that the request endpoint
    /// cannot be used to learn whether an address has an account, that a token works exactly once
    /// and only for as long as configured, that every unusable token fails the same way, and that a
    /// completed reset ends the account's other sessions.
    /// </remarks>
    public class PasswordResetEndpointTests
    {
        private const string Password = "Test1234!@#";
        private const string NewPassword = "Replaced5678!@#";
        private const string ForgotPath = "/account/password/forgot";
        private const string ResetPath = "/account/password/reset";

        [Fact]
        public async Task ForgotPassword_AnswersIdentically_ForRegisteredAndUnregisteredAddresses()
        {
            using var factory = new PasswordResetFactory();
            using var client = factory.CreateClient();

            var registered = $"parity-known-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, registered);

            var (knownResponse, knownBody, knownElapsed) = await PostForgotAsync(client, registered);
            var (unknownResponse, unknownBody, unknownElapsed) =
                await PostForgotAsync(client, $"parity-unknown-{Guid.NewGuid()}@example.com");

            // Same status, same body: nothing in the response distinguishes the two.
            knownResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            unknownResponse.StatusCode.Should().Be(knownResponse.StatusCode);
            unknownBody.Should().Be(knownBody);

            // And nothing in the clock does either: issuing a token costs real time, so both
            // outcomes are held to the same floor.
            var floor = TimeSpan.FromMilliseconds(250);
            knownElapsed.Should().BeGreaterThanOrEqualTo(floor);
            unknownElapsed.Should().BeGreaterThanOrEqualTo(floor);

            // The token really was issued for the registered address, and only for it.
            factory.Issued.Should().ContainSingle().Which.Email.Should().Be(registered);
        }

        [Fact]
        public async Task ResetPassword_SetsTheNewPassword_AndTheTokenCannotBeUsedTwice()
        {
            using var factory = new PasswordResetFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"single-use-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, email);
            var resetCode = await RequestResetCodeAsync(factory, client, email);

            var first = await PostResetAsync(client, email, resetCode, NewPassword);
            first.StatusCode.Should().Be(HttpStatusCode.OK);

            // The new password is live...
            var login = await client.PostAsJsonAsync("/account/login", new { email, password = NewPassword });
            login.StatusCode.Should().Be(HttpStatusCode.OK);

            // ...and the token that set it is spent. Redeeming it again fails, and fails opaquely.
            var second = await PostResetAsync(client, email, resetCode, "Another9999!@#");
            second.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await second.Content.ReadAsStringAsync()).Should().Be(await InvalidTokenBodyAsync(client, email));
        }

        [Fact]
        public async Task ResetPassword_RejectsAnExpiredToken()
        {
            // The lifetime is configuration, and this is the proof: a negative lifetime makes every
            // issued token already expired, with no sleeping in the test.
            using var factory = new PasswordResetFactory(options =>
            {
                NoDelay(options);
                options.TokenLifetime = TimeSpan.FromSeconds(-1);
            });
            using var client = factory.CreateClient();

            var email = $"expired-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, email);
            var resetCode = await RequestResetCodeAsync(factory, client, email);

            var response = await PostResetAsync(client, email, resetCode, NewPassword);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadAsStringAsync()).Should().Be(await InvalidTokenBodyAsync(client, email));

            // The old password still works — an expired token changed nothing.
            var login = await client.PostAsJsonAsync("/account/login", new { email, password = Password });
            login.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task ResetPassword_FailsIndistinguishably_ForTamperedUnknownAndMalformedTokens()
        {
            using var factory = new PasswordResetFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"opaque-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, email);
            var resetCode = await RequestResetCodeAsync(factory, client, email);

            // A single flipped character in an otherwise well-formed code.
            var tampered = resetCode[..^1] + (resetCode[^1] == 'A' ? 'B' : 'A');

            var responses = new[]
            {
                await PostResetAsync(client, email, tampered, NewPassword),
                await PostResetAsync(client, email, "not-a-valid-base64url-code!!", NewPassword),
                await PostResetAsync(client, $"never-registered-{Guid.NewGuid()}@example.com", resetCode, NewPassword),
                await PostResetAsync(client, email, string.Empty, NewPassword),
            };

            var expectedBody = await InvalidTokenBodyAsync(client, email);
            foreach (var response in responses)
            {
                response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
                (await response.Content.ReadAsStringAsync()).Should().Be(expectedBody);
            }

            foreach (var response in responses)
            {
                response.Dispose();
            }
        }

        [Fact]
        public async Task ResetPassword_RevokesExistingSessions()
        {
            using var factory = new PasswordResetFactory(NoDelay);
            using var sessionClient = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                HandleCookies = true,
                AllowAutoRedirect = false,
            });

            var email = $"revoke-on-reset-{Guid.NewGuid()}@example.com";
            await RegisterAsync(sessionClient, email);

            var login = await sessionClient.PostAsJsonAsync(
                "/account/login?useCookies=true",
                new { email, password = Password });
            login.EnsureSuccessStatusCode();
            (await sessionClient.GetAsync("/account/profile")).StatusCode.Should().Be(HttpStatusCode.OK);

            // Reset from somewhere else entirely — the attacker's session is the one holding the cookie.
            using var resetClient = factory.CreateClient();
            var resetCode = await RequestResetCodeAsync(factory, resetClient, email);
            (await PostResetAsync(resetClient, email, resetCode, NewPassword)).StatusCode
                .Should().Be(HttpStatusCode.OK);

            // The pre-existing session is gone. A reset performed because the account was
            // compromised actually removes whoever was in it.
            (await sessionClient.GetAsync("/account/profile")).StatusCode
                .Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task ResetPassword_InvalidatesExistingRefreshTokens()
        {
            using var factory = new PasswordResetFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"refresh-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, email);

            using var login = await client.PostAsJsonAsync("/account/login", new { email, password = Password });
            login.EnsureSuccessStatusCode();
            var refreshToken = (await login.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("refreshToken").GetString();

            var resetCode = await RequestResetCodeAsync(factory, client, email);
            (await PostResetAsync(client, email, resetCode, NewPassword)).StatusCode
                .Should().Be(HttpStatusCode.OK);

            // Refresh revalidates the security stamp, so the refresh material an attacker captured
            // before the reset can no longer be exchanged for a new access token.
            using var refresh = await client.PostAsJsonAsync("/account/refresh", new { refreshToken });
            refresh.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task ResetPassword_ClearsALockoutCausedByFailedLogins()
        {
            using var factory = new PasswordResetFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"lockout-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, email);

            // Spray the account until Identity locks it (default: 5 failures).
            for (var attempt = 0; attempt < 6; attempt++)
            {
                using var failed = await client.PostAsJsonAsync(
                    "/account/login",
                    new { email, password = "Wrong1234!@#" });
                failed.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            }

            var resetCode = await RequestResetCodeAsync(factory, client, email);
            (await PostResetAsync(client, email, resetCode, NewPassword)).StatusCode
                .Should().Be(HttpStatusCode.OK);

            // Recovering from the spraying must not leave the owner locked out by it.
            using var login = await client.PostAsJsonAsync("/account/login", new { email, password = NewPassword });
            login.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task ForgotPassword_CountsTheCallerFromXRealIp_NotTheGatewaysOwnAddress()
        {
            using var factory = new PasswordResetFactory(options =>
            {
                NoDelay(options);
                options.RequestsPerEmail = 100;
                options.RequestsPerAddress = 1;
            });
            using var client = factory.CreateClient();

            // Every request here shares one transport peer — which in production is the gateway pod,
            // for every consumer at once. Only the forwarded address can tell them apart.
            (await PostForgotAsync(client, $"ip-a-{Guid.NewGuid()}@example.com", "203.0.113.1"))
                .Response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await PostForgotAsync(client, $"ip-b-{Guid.NewGuid()}@example.com", "203.0.113.1"))
                .Response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);

            // A different caller is unaffected — one exhausted budget must not deny recovery to
            // everyone else behind the same gateway.
            (await PostForgotAsync(client, $"ip-c-{Guid.NewGuid()}@example.com", "203.0.113.2"))
                .Response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task ResetPassword_EnforcesTheSamePasswordPolicyAsRegistration()
        {
            using var factory = new PasswordResetFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"policy-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, email);
            var resetCode = await RequestResetCodeAsync(factory, client, email);

            const string WeakPassword = "abc";

            using var reset = await PostResetAsync(client, email, resetCode, WeakPassword);
            reset.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var resetBody = await reset.Content.ReadAsStringAsync();

            using var register = await client.PostAsJsonAsync(
                "/account/register",
                new { email = $"policy-signup-{Guid.NewGuid()}@example.com", password = WeakPassword });
            register.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var registerBody = await register.Content.ReadAsStringAsync();

            // Both surfaces run the same validators and report the same error codes, so the two
            // cannot drift into different rules for the same field.
            foreach (var code in new[] { "PasswordTooShort", "PasswordRequiresNonAlphanumeric", "PasswordRequiresDigit", "PasswordRequiresUpper" })
            {
                registerBody.Should().Contain(code);
                resetBody.Should().Contain(code);
            }

            // A policy failure is reported as itself, not disguised as a bad token — the caller
            // already proved they hold a valid one.
            resetBody.Should().NotContain("resetCode");
        }

        [Fact]
        public async Task ForgotPassword_RateLimitsPerEmailAddress()
        {
            using var factory = new PasswordResetFactory(options =>
            {
                NoDelay(options);
                options.RequestsPerEmail = 2;
                options.RequestsPerAddress = 100;
            });
            using var client = factory.CreateClient();

            var email = $"per-email-limit-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, email);

            (await PostForgotAsync(client, email)).Response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await PostForgotAsync(client, email)).Response.StatusCode.Should().Be(HttpStatusCode.OK);

            var refused = (await PostForgotAsync(client, email)).Response;
            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            refused.Headers.RetryAfter.Should().NotBeNull();

            // The limit follows the address that was asked about, not the caller: a different
            // address is still served.
            (await PostForgotAsync(client, $"per-email-other-{Guid.NewGuid()}@example.com"))
                .Response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task ForgotPassword_RateLimitsPerClientAddress()
        {
            using var factory = new PasswordResetFactory(options =>
            {
                NoDelay(options);
                options.RequestsPerEmail = 100;
                options.RequestsPerAddress = 2;
            });
            using var client = factory.CreateClient();

            // Every request names a different address, so only the per-client limit can bite.
            (await PostForgotAsync(client, $"a-{Guid.NewGuid()}@example.com")).Response.StatusCode
                .Should().Be(HttpStatusCode.OK);
            (await PostForgotAsync(client, $"b-{Guid.NewGuid()}@example.com")).Response.StatusCode
                .Should().Be(HttpStatusCode.OK);
            (await PostForgotAsync(client, $"c-{Guid.NewGuid()}@example.com")).Response.StatusCode
                .Should().Be(HttpStatusCode.TooManyRequests);
        }

        [Fact]
        public async Task ResetPassword_RateLimitsRedemptionAttempts()
        {
            using var factory = new PasswordResetFactory(options =>
            {
                NoDelay(options);
                options.RedemptionsPerAddress = 1;
            });
            using var client = factory.CreateClient();

            var email = $"redeem-limit-{Guid.NewGuid()}@example.com";

            using var first = await PostResetAsync(client, email, "some-code", NewPassword);
            first.StatusCode.Should().Be(HttpStatusCode.BadRequest);

            using var second = await PostResetAsync(client, email, "some-code", NewPassword);
            second.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        }

        [Fact]
        public async Task IdentitysOwnPasswordResetEndpoints_AreGone()
        {
            using var factory = new PasswordResetFactory(NoDelay);
            using var client = factory.CreateClient();

            // These answered 200 having done nothing, for every account, because nothing in this
            // platform confirms an email address. A 404 is the honest answer.
            using var forgot = await client.PostAsJsonAsync(
                "/account/forgotPassword",
                new { email = $"suppressed-{Guid.NewGuid()}@example.com" });
            forgot.StatusCode.Should().Be(HttpStatusCode.NotFound);

            using var reset = await client.PostAsJsonAsync(
                "/account/resetPassword",
                new { email = "a@example.com", resetCode = "x", newPassword = NewPassword });
            reset.StatusCode.Should().Be(HttpStatusCode.NotFound);

            // The rest of the Identity group is untouched.
            using var register = await client.PostAsJsonAsync(
                "/account/register",
                new { email = $"still-works-{Guid.NewGuid()}@example.com", password = Password });
            register.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task OpenApiDocument_AdvertisesTheRealEndpoints_AndNotTheSuppressedOnes()
        {
            using var factory = new PasswordResetFactory(NoDelay);
            using var client = factory.CreateClient();

            using var response = await client.GetAsync("/openapi/v1.json");
            response.EnsureSuccessStatusCode();
            var document = await response.Content.ReadAsStringAsync();

            // This document is aggregated into the gateway's public Swagger UI, so an endpoint that
            // answers 404 must not be advertised there either. Reachability and advertisement are
            // separate problems; both have to be closed.
            document.Should().Contain(ForgotPath);
            document.Should().Contain(ResetPath);
            document.Should().NotContain("/account/forgotPassword");
            document.Should().NotContain("/account/resetPassword");
        }

        private static void NoDelay(PasswordResetOptions options) =>
            options.MinimumResponseDuration = TimeSpan.Zero;

        private static async Task RegisterAsync(HttpClient client, string email)
        {
            using var response = await client.PostAsJsonAsync(
                "/account/register",
                new { email, password = Password });
            response.EnsureSuccessStatusCode();
        }

        private static async Task<(HttpResponseMessage Response, string Body, TimeSpan Elapsed)> PostForgotAsync(
            HttpClient client,
            string email,
            string? realIp = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, ForgotPath)
            {
                Content = JsonContent.Create(new { email }),
            };

            if (realIp is not null)
            {
                request.Headers.Add("X-Real-IP", realIp);
            }

            var startedAt = Stopwatch.GetTimestamp();
            var response = await client.SendAsync(request);
            var elapsed = Stopwatch.GetElapsedTime(startedAt);
            return (response, await response.Content.ReadAsStringAsync(), elapsed);
        }

        private static Task<HttpResponseMessage> PostResetAsync(
            HttpClient client,
            string email,
            string resetCode,
            string newPassword) =>
            client.PostAsJsonAsync(ResetPath, new { email, resetCode, newPassword });

        private static async Task<string> RequestResetCodeAsync(
            PasswordResetFactory factory,
            HttpClient client,
            string email)
        {
            var issuedBefore = factory.Issued.Count;

            using var response = await client.PostAsJsonAsync(ForgotPath, new { email });
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var issued = factory.Issued;
            issued.Should().HaveCount(issuedBefore + 1);
            return issued[^1].ResetCode;
        }

        /// <summary>
        /// The exact body every unusable token produces, obtained from a request that is definitely
        /// invalid, so the other cases are compared against a real response rather than a literal.
        /// </summary>
        private static async Task<string> InvalidTokenBodyAsync(HttpClient client, string email)
        {
            using var response = await PostResetAsync(client, email, "definitely-not-a-token", NewPassword);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            return await response.Content.ReadAsStringAsync();
        }
    }
}
