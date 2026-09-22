// <copyright file="AccountRecoveryEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Configuration;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for password reset on ASP.NET Core Identity's own
    /// <c>/account/forgotPassword</c> and <c>/account/resetPassword</c> (#136).
    /// </summary>
    /// <remarks>
    /// <para>
    /// The security properties are the subject here, not the happy path: that the request endpoints
    /// cannot be used to learn whether an address has an account, that a reset token works exactly
    /// once and only for as long as configured, that every unusable token fails the same way, and
    /// that a completed reset ends the account's other sessions.
    /// </para>
    /// <para>
    /// These endpoints are the framework's, so several of these tests pin <em>Identity's</em>
    /// behaviour rather than ours. That is the point: the guarantees are only ours to keep if we can
    /// see them break when the framework moves. Where a guarantee is ours — the rate limits, the
    /// response-timing floor, the lockout clearing, the soft-delete refusal — the test says so.
    /// </para>
    /// <para>
    /// Registration, confirmation and resend are covered by
    /// <see cref="EmailConfirmationEndpointTests"/>; the helpers here only register and confirm an
    /// account as the precondition a reset needs.
    /// </para>
    /// </remarks>
    public class AccountRecoveryEndpointTests
    {
        private const string Password = "Test1234!@#";
        private const string NewPassword = "Replaced5678!@#";
        private const string RegisterPath = "/account/register";
        private const string ForgotPath = "/account/forgotPassword";
        private const string ResetPath = "/account/resetPassword";
        private const string ConfirmPath = "/account/confirmEmail";
        private const string ResendPath = "/account/resendConfirmationEmail";

        [Fact]
        public async Task ForgotPassword_AnswersIdentically_ForRegisteredAndUnregisteredAddresses()
        {
            using var factory = new AccountRecoveryFactory(WithFloor);
            using var client = factory.CreateClient();

            var registered = $"parity-known-{Guid.NewGuid()}@example.com";
            await RegisterAndConfirmAsync(factory, client, registered);

            var (knownResponse, knownBody, knownElapsed) = await PostForgotAsync(client, registered);
            var (unknownResponse, unknownBody, unknownElapsed) =
                await PostForgotAsync(client, $"parity-unknown-{Guid.NewGuid()}@example.com");

            // Same status, same body: nothing in the response distinguishes the two. This half is
            // Identity's own guarantee — its handler returns TypedResults.Ok() unconditionally.
            knownResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            unknownResponse.StatusCode.Should().Be(knownResponse.StatusCode);
            unknownBody.Should().Be(knownBody);

            // And nothing in the clock does either. This half is ours: Identity does nothing about
            // timing, and issuing a token costs real time while finding no account costs almost
            // none, so both outcomes are held to the same floor by AccountRecoveryThrottleFilter.
            AssertHeldToTheFloor(knownElapsed, unknownElapsed);

            // The token really was issued for the registered address, and only for it.
            factory.ResetCodes.Should().ContainSingle().Which.Email.Should().Be(registered);

            knownResponse.Dispose();
            unknownResponse.Dispose();
        }

        [Fact]
        public async Task ForgotPassword_IssuesNothing_ForAnAddressThatHasNotBeenConfirmed()
        {
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"unconfirmed-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, email);

            // Identity gates the reset on IsEmailConfirmedAsync:
            //   if (user is not null && await userManager.IsEmailConfirmedAsync(user))
            // so a registered-but-unconfirmed address gets the same empty 200 and no token at all.
            //
            // This test exists to keep that visible rather than surprising, because it is the whole
            // consequence of the product ruling on #147 that existing accounts are NOT
            // grandfathered: nothing in this service has ever written EmailConfirmed, so every
            // account created before confirmation shipped has it false, and this endpoint answers
            // 200 and issues nothing for all of them until their owner confirms through
            // /resendConfirmationEmail. That is the intended path, and this is the test that stops
            // it being rediscovered as a bug.
            var (response, _, _) = await PostForgotAsync(client, email);
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            factory.ResetCodes.Should().BeEmpty();

            // Confirm the address and the very same request now issues a token.
            await ConfirmAsync(factory, client, email);
            var (afterConfirm, _, _) = await PostForgotAsync(client, email);
            afterConfirm.StatusCode.Should().Be(HttpStatusCode.OK);
            factory.ResetCodes.Should().ContainSingle().Which.Email.Should().Be(email);

            response.Dispose();
            afterConfirm.Dispose();
        }

        [Fact]
        public async Task ResetPassword_SetsTheNewPassword_AndTheTokenCannotBeUsedTwice()
        {
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"single-use-{Guid.NewGuid()}@example.com";
            await RegisterAndConfirmAsync(factory, client, email);
            var resetCode = await RequestResetCodeAsync(factory, client, email);

            using var first = await PostResetAsync(client, email, resetCode, NewPassword);
            first.StatusCode.Should().Be(HttpStatusCode.OK);

            // The new password is live...
            using var login = await client.PostAsJsonAsync("/account/login", new { email, password = NewPassword });
            login.StatusCode.Should().Be(HttpStatusCode.OK);

            // ...and the token that set it is spent, because ResetPasswordAsync rotates the security
            // stamp that is part of the token's own payload. Redeeming it again fails, and fails
            // opaquely.
            using var second = await PostResetAsync(client, email, resetCode, "Another9999!@#");
            second.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await second.Content.ReadAsStringAsync()).Should().Be(await InvalidTokenBodyAsync(client, email));
        }

        [Fact]
        public async Task ResetPassword_RejectsAnExpiredToken()
        {
            // The lifetime is configuration, and this is the proof: a 1ms lifetime makes every
            // issued reset token expired by the time it is redeemed, with no sleeping in the test.
            // A negative value is not used here: AccountRecoveryOptions.Validate rejects it at
            // startup, since a real deployment misconfigured this way should fail loudly rather than
            // silently expire every token.
            //
            // It also proves the lifetime is *isolated*. Email confirmation still works below on the
            // same host, because it runs on Identity's shared DataProtectionTokenProviderOptions
            // while reset runs on the dedicated PasswordResetTokenProvider. Without that separate
            // provider this setting would have expired the confirmation token too.
            using var factory = new AccountRecoveryFactory(options =>
            {
                NoDelay(options);
                options.TokenLifetime = TimeSpan.FromMilliseconds(1);
            });
            using var client = factory.CreateClient();

            var email = $"expired-{Guid.NewGuid()}@example.com";
            await RegisterAndConfirmAsync(factory, client, email);
            var resetCode = await RequestResetCodeAsync(factory, client, email);

            using var response = await PostResetAsync(client, email, resetCode, NewPassword);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadAsStringAsync()).Should().Be(await InvalidTokenBodyAsync(client, email));

            // The old password still works — an expired token changed nothing.
            using var login = await client.PostAsJsonAsync("/account/login", new { email, password = Password });
            login.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task ResetPassword_FailsIndistinguishably_ForTamperedUnknownAndMalformedTokens()
        {
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"opaque-{Guid.NewGuid()}@example.com";
            await RegisterAndConfirmAsync(factory, client, email);
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
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var sessionClient = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                HandleCookies = true,
                AllowAutoRedirect = false,
            });

            var email = $"revoke-on-reset-{Guid.NewGuid()}@example.com";
            await RegisterAndConfirmAsync(factory, sessionClient, email);

            using var login = await sessionClient.PostAsJsonAsync(
                "/account/login?useCookies=true",
                new { email, password = Password });
            login.EnsureSuccessStatusCode();
            using (var profile = await sessionClient.GetAsync("/account/profile"))
            {
                profile.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            // Reset from somewhere else entirely — the attacker's session is the one holding the cookie.
            using var resetClient = factory.CreateClient();
            var resetCode = await RequestResetCodeAsync(factory, resetClient, email);
            using (var reset = await PostResetAsync(resetClient, email, resetCode, NewPassword))
            {
                reset.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            // The pre-existing session is gone. A reset performed because the account was
            // compromised actually removes whoever was in it.
            using var afterReset = await sessionClient.GetAsync("/account/profile");
            afterReset.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task ResetPassword_InvalidatesExistingRefreshTokens()
        {
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"refresh-{Guid.NewGuid()}@example.com";
            await RegisterAndConfirmAsync(factory, client, email);

            using var login = await client.PostAsJsonAsync("/account/login", new { email, password = Password });
            login.EnsureSuccessStatusCode();
            var refreshToken = (await login.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("refreshToken").GetString();

            var resetCode = await RequestResetCodeAsync(factory, client, email);
            using (var reset = await PostResetAsync(client, email, resetCode, NewPassword))
            {
                reset.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            // Refresh revalidates the security stamp, so the refresh material an attacker captured
            // before the reset can no longer be exchanged for a new access token.
            using var refresh = await client.PostAsJsonAsync("/account/refresh", new { refreshToken });
            refresh.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task ResetPassword_ClearsALockoutCausedByFailedLogins()
        {
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"lockout-{Guid.NewGuid()}@example.com";
            await RegisterAndConfirmAsync(factory, client, email);

            // Spray the account until Identity locks it (default: 5 failures).
            for (var attempt = 0; attempt < 6; attempt++)
            {
                using var failed = await client.PostAsJsonAsync(
                    "/account/login",
                    new { email, password = "Wrong1234!@#" });
                failed.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            }

            var resetCode = await RequestResetCodeAsync(factory, client, email);
            using (var reset = await PostResetAsync(client, email, resetCode, NewPassword))
            {
                reset.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            // Recovering from the spraying must not leave the owner locked out by it. Identity's
            // ResetPasswordAsync leaves LockoutEnd and AccessFailedCount alone, so this is ours —
            // see AppUserManager.ResetPasswordAsync.
            using var login = await client.PostAsJsonAsync("/account/login", new { email, password = NewPassword });
            login.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task SoftDeletedAccount_IsNotRecoverable_AndSaysNothingAboutWhy()
        {
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"soft-deleted-{Guid.NewGuid()}@example.com";
            await RegisterAndConfirmAsync(factory, client, email);

            // Take a valid reset code while the account is still live, then delete the account.
            var resetCode = await RequestResetCodeAsync(factory, client, email);

            using var login = await client.PostAsJsonAsync("/account/login", new { email, password = Password });
            login.EnsureSuccessStatusCode();
            var accessToken = (await login.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("accessToken").GetString();

            using var delete = new HttpRequestMessage(HttpMethod.Delete, "/account/profile");
            delete.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            using (var deleted = await client.SendAsync(delete))
            {
                deleted.StatusCode.Should().Be(HttpStatusCode.NoContent);
            }

            // A new request issues nothing, and answers exactly as an unknown address does.
            var issuedBefore = factory.ResetCodes.Count;
            var (forgot, _, _) = await PostForgotAsync(client, email);
            forgot.StatusCode.Should().Be(HttpStatusCode.OK);
            factory.ResetCodes.Should().HaveCount(issuedBefore);

            // And the code taken before the deletion is refused with the same opaque failure as any
            // other unusable token.
            //
            // Note what this second assertion does and does not prove. It is NOT evidence for the
            // AppUserManager.IsEmailConfirmedAsync override: DELETE /account/profile calls
            // UpdateSecurityStampAsync (Routes/Profile.cs), the stamp is embedded in the token and
            // compared on validate, so this code would be refused with or without the override.
            // Only the /forgotPassword assertion above actually exercises it. This is kept because
            // the end-to-end behaviour is worth pinning, not because it tests the override.
            using var reset = await PostResetAsync(client, email, resetCode, NewPassword);
            reset.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await reset.Content.ReadAsStringAsync()).Should().Be(await InvalidTokenBodyAsync(client, email));

            forgot.Dispose();
        }

        [Fact]
        public async Task ForgotPassword_CountsTheCallerFromXRealIp_NotTheGatewaysOwnAddress()
        {
            using var factory = new AccountRecoveryFactory(options =>
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
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"policy-{Guid.NewGuid()}@example.com";
            await RegisterAndConfirmAsync(factory, client, email);
            var resetCode = await RequestResetCodeAsync(factory, client, email);

            const string WeakPassword = "abc";

            using var reset = await PostResetAsync(client, email, resetCode, WeakPassword);
            reset.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var resetBody = await reset.Content.ReadAsStringAsync();

            using var register = await client.PostAsJsonAsync(
                RegisterPath,
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
            // already proved they hold a valid one, since Identity verifies the token before it
            // validates the password.
            resetBody.Should().NotContain("InvalidToken");
        }

        [Fact]
        public async Task ForgotPassword_RateLimitsPerEmailAddress()
        {
            using var factory = new AccountRecoveryFactory(options =>
            {
                NoDelay(options);
                options.RequestsPerEmail = 2;
                options.RequestsPerAddress = 100;
            });
            using var client = factory.CreateClient();

            var email = $"per-email-limit-{Guid.NewGuid()}@example.com";
            await RegisterAndConfirmAsync(factory, client, email);

            (await PostForgotAsync(client, email)).Response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await PostForgotAsync(client, email)).Response.StatusCode.Should().Be(HttpStatusCode.OK);

            var refused = (await PostForgotAsync(client, email)).Response;
            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            refused.Headers.RetryAfter.Should().NotBeNull();
            refused.Dispose();

            // The limit follows the address that was asked about, not the caller: a different
            // address is still served.
            (await PostForgotAsync(client, $"per-email-other-{Guid.NewGuid()}@example.com"))
                .Response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task ForgotPassword_RateLimitsPerClientAddress()
        {
            using var factory = new AccountRecoveryFactory(options =>
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
            using var factory = new AccountRecoveryFactory(options =>
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
        public async Task ThrottleFilter_LeavesNonRecoveryEndpointsAlone()
        {
            // The filter is attached to the WHOLE Identity group, so it also runs for /login,
            // /refresh, /confirmEmail and /manage/*. It is supposed to pass those straight through.
            //
            // Without this test nothing would notice if, say, /login started consuming the
            // registration budget — every other test either raises the limits out of the way or
            // lowers only the single limit it is exercising. Here the registration budget is 1 and
            // is spent immediately, so any bleed from the login path shows up as a 429.
            using var factory = new AccountRecoveryFactory(options =>
            {
                NoDelay(options);
                options.RegistrationsPerAddress = 1;
                options.RequestsPerAddress = 1;
                options.RedemptionsPerAddress = 1;
            });
            using var client = factory.CreateClient();

            var email = $"passthrough-{Guid.NewGuid()}@example.com";
            await RegisterAndConfirmAsync(factory, client, email);

            // Spend every recovery budget there is.
            using (var forgot = await client.PostAsJsonAsync(ForgotPath, new { email }))
            {
                forgot.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            // Logging in repeatedly is unaffected by all of that.
            for (var attempt = 0; attempt < 4; attempt++)
            {
                using var login = await client.PostAsJsonAsync("/account/login", new { email, password = Password });
                login.StatusCode.Should().Be(HttpStatusCode.OK, "login is not part of the recovery surface");
            }

            // And so is confirming — which has no request DTO at all, the case that would throw if
            // the filter indexed arguments instead of searching them.
            await ConfirmAsync(factory, client, email);

            // Meanwhile the budgets really were spent, so the limits are genuinely in force and
            // this test is not passing because the filter is inert everywhere.
            using var refused = await client.PostAsJsonAsync(ForgotPath, new { email });
            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        }

        [Fact]
        public async Task IdentityRecoveryEndpoints_ArePresent_AndAdvertisedInTheOpenApiDocument()
        {
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var client = factory.CreateClient();

            // The inverse of the assertion this replaces. Identity's endpoints are now the real and
            // only recovery surface, so being reachable *and* advertised is the guarantee — the
            // OpenAPI document here is aggregated into the gateway's public Swagger UI.
            using var forgot = await client.PostAsJsonAsync(
                ForgotPath,
                new { email = $"present-{Guid.NewGuid()}@example.com" });
            forgot.StatusCode.Should().Be(HttpStatusCode.OK);

            using var reset = await client.PostAsJsonAsync(
                ResetPath,
                new { email = "a@example.com", resetCode = "x", newPassword = NewPassword });
            reset.StatusCode.Should().Be(HttpStatusCode.BadRequest);

            using var resend = await client.PostAsJsonAsync(
                ResendPath,
                new { email = $"present-resend-{Guid.NewGuid()}@example.com" });
            resend.StatusCode.Should().Be(HttpStatusCode.OK);

            using var response = await client.GetAsync("/openapi/v1.json");
            response.EnsureSuccessStatusCode();
            var document = await response.Content.ReadAsStringAsync();

            foreach (var path in new[] { RegisterPath, ForgotPath, ResetPath, ConfirmPath, ResendPath })
            {
                document.Should().Contain(path);
            }

            // And nothing is left advertising the abandoned bespoke paths.
            document.Should().NotContain("/account/password/forgot");
            document.Should().NotContain("/account/password/reset");
        }

        [Fact]
        public async Task ConfirmEmailEndpoint_IsNamed_SoRegistrationCanBuildItsLink()
        {
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var client = factory.CreateClient();

            // MapIdentityApi stores this name in a closure and both /register and
            // /resendConfirmationEmail resolve the confirmation URL through it. If the endpoint
            // stops carrying the name, /register throws NotSupportedException *after* the user row
            // is committed — a 500 against an account that exists and can never be confirmed. This
            // pins the dependency directly rather than only through its symptom.
            var endpoints = factory.Services
                .GetRequiredService<Microsoft.AspNetCore.Routing.EndpointDataSource>()
                .Endpoints;

            endpoints.Should().Contain(
                endpoint => endpoint.Metadata
                    .GetMetadata<Microsoft.AspNetCore.Routing.EndpointNameMetadata>() != null &&
                    endpoint.Metadata
                        .GetMetadata<Microsoft.AspNetCore.Routing.EndpointNameMetadata>()!
                        .EndpointName == $"MapIdentityApi-{ConfirmPath}");

            // The symptom, asserted too: registration succeeds and produces a link.
            await RegisterAsync(client, $"named-{Guid.NewGuid()}@example.com");
            factory.ConfirmationLinks.Should().ContainSingle();
        }

        private static void NoDelay(AccountRecoveryOptions options) =>
            options.MinimumResponseDuration = TimeSpan.Zero;

        /// <summary>
        /// A floor of 1 second, not the 250ms configured in production, so the gap between "held to
        /// the floor" and "not padded at all" is far wider than the scheduling noise observed on CI
        /// runners (up to ~180ms, #290). See <see cref="AssertHeldToTheFloor"/>.
        /// </summary>
        private static void WithFloor(AccountRecoveryOptions options) =>
            options.MinimumResponseDuration = TimeSpan.FromSeconds(1);

        /// <summary>
        /// Asserts that a found-an-account request and a found-nothing request were both held to the
        /// configured response floor, and stayed close to each other.
        /// </summary>
        /// <remarks>
        /// <para>
        /// <c>AccountRecoveryThrottleFilter.PadAsync</c> pads each response, independently, up to
        /// the configured floor. The two floor assertions are noise-tolerant on their own, because
        /// scheduler noise only pushes an elapsed time up and an upward push still clears the floor.
        /// They do not, alone, catch a regression where the registered-address path's own work
        /// grows past the floor: padding is then skipped (nothing left to wait for), the floor
        /// assertion still passes on real work alone, and the two paths become distinguishable by
        /// timing again. The delta assertion is what catches that.
        /// </para>
        /// <para>
        /// The delta assertion previously ran against a 250ms floor with a 150ms bound, and failed
        /// intermittently: CI scheduler noise alone produced deltas up to ~180ms between two
        /// separately measured requests (#290), above the bound, while both requests still met the
        /// floor. Raising the floor to 1 second (see <see cref="WithFloor"/>) does not change that
        /// noise, which comes from OS thread scheduling rather than from the size of the delay, but
        /// it does change what a real regression looks like: padding removed from one branch now
        /// opens a gap of roughly 1 second, not roughly 220ms. A 400ms delta bound sits well above
        /// the observed noise and well below that gap, so it separates the two reliably.
        /// </para>
        /// <para>
        /// The floor is asserted with a tolerance rather than exactly, and the tolerance is not
        /// slop. <c>Task.Delay</c> schedules on the runtime's timer wheel, whose resolution is about
        /// 15ms on Windows, while the filter measures its elapsed time with <c>Stopwatch</c> (the
        /// high-resolution performance counter). The two clocks do not agree to the millisecond, so
        /// a pad asked for 1 second can land a few milliseconds short when measured by the other
        /// one. Asserting the exact floor literally makes this test fail a few runs in a hundred
        /// while the guarantee it is testing is perfectly intact — and a floor missed by a few
        /// milliseconds leaks nothing.
        /// </para>
        /// </remarks>
        private static void AssertHeldToTheFloor(TimeSpan knownElapsed, TimeSpan unknownElapsed)
        {
            var floor = TimeSpan.FromSeconds(1);
            var tolerance = TimeSpan.FromMilliseconds(25);

            knownElapsed.Should().BeGreaterThanOrEqualTo(floor - tolerance);
            unknownElapsed.Should().BeGreaterThanOrEqualTo(floor - tolerance);

            // Wide enough to survive scheduling jitter on a loaded CI box (~180ms observed), tight
            // enough that a ~1s gap from missing padding, or from real work growing past the floor
            // on one branch only, fails.
            (knownElapsed - unknownElapsed).Duration().Should().BeLessThan(TimeSpan.FromMilliseconds(400));
        }

        private static async Task RegisterAsync(HttpClient client, string email)
        {
            using var response = await client.PostAsJsonAsync(RegisterPath, new { email, password = Password });
            response.EnsureSuccessStatusCode();
        }

        /// <summary>
        /// Confirms an already-registered address by following the link the service issued for it.
        /// </summary>
        /// <remarks>
        /// The credential is rebuilt onto the web origin and <c>ConfirmationPath</c>
        /// (<c>/confirm-email</c>), which is the web app's route, not this service's. Only its query
        /// string — Identity's <c>userId</c> and <c>code</c> — carries over onto the real
        /// <c>/account/confirmEmail</c> endpoint, exactly as the web app would call it.
        /// </remarks>
        private static async Task ConfirmAsync(
            AccountRecoveryFactory factory,
            HttpClient client,
            string email)
        {
            var link = factory.ConfirmationLinks.Last(message => message.Email == email);
            var query = new Uri(link.Credential).Query;

            using var response = await client.GetAsync(ConfirmPath + query);
            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        /// <summary>
        /// Registers an account and confirms its address, which is the precondition for password
        /// reset: Identity issues a reset token only for a confirmed address.
        /// </summary>
        private static async Task RegisterAndConfirmAsync(
            AccountRecoveryFactory factory,
            HttpClient client,
            string email)
        {
            await RegisterAsync(client, email);
            await ConfirmAsync(factory, client, email);
        }

        private static Task<(HttpResponseMessage Response, string Body, TimeSpan Elapsed)> PostForgotAsync(
            HttpClient client,
            string email,
            string? realIp = null) =>
            PostTimedAsync(client, ForgotPath, email, realIp);

        private static async Task<(HttpResponseMessage Response, string Body, TimeSpan Elapsed)> PostTimedAsync(
            HttpClient client,
            string path,
            string email,
            string? realIp)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, path)
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
            AccountRecoveryFactory factory,
            HttpClient client,
            string email)
        {
            var issuedBefore = factory.ResetCodes.Count;

            using var response = await client.PostAsJsonAsync(ForgotPath, new { email });
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var issued = factory.ResetCodes;
            issued.Should().HaveCount(issuedBefore + 1);
            return issued[^1].Credential;
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
