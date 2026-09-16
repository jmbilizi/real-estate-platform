// <copyright file="AccountRecoveryEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Configuration;
using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for the account-recovery surface: ASP.NET Core Identity's own
    /// <c>/account/register</c>, <c>/account/confirmEmail</c>,
    /// <c>/account/resendConfirmationEmail</c>, <c>/account/forgotPassword</c> and
    /// <c>/account/resetPassword</c>.
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
            using var factory = new AccountRecoveryFactory();
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
            // The lifetime is configuration, and this is the proof: a negative lifetime makes every
            // issued reset token already expired, with no sleeping in the test.
            //
            // It also proves the lifetime is *isolated*. Email confirmation still works below on the
            // same host, because it runs on Identity's shared DataProtectionTokenProviderOptions
            // while reset runs on the dedicated PasswordResetTokenProvider. Without that separate
            // provider this setting would have expired the confirmation token too.
            using var factory = new AccountRecoveryFactory(options =>
            {
                NoDelay(options);
                options.TokenLifetime = TimeSpan.FromSeconds(-1);
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
            // other unusable token. Both come from AppUserManager.IsEmailConfirmedAsync reporting a
            // deleted account as unconfirmed, which is the one predicate Identity consults on both
            // paths.
            using var reset = await PostResetAsync(client, email, resetCode, NewPassword);
            reset.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await reset.Content.ReadAsStringAsync()).Should().Be(await InvalidTokenBodyAsync(client, email));

            forgot.Dispose();
        }

        [Fact]
        public async Task Register_SendsAConfirmationLink_ThatConfirmsTheAddress()
        {
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"confirm-flow-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, email);

            // The link is generated by LinkGenerator.GetUriByName against the endpoint name
            // MapIdentityApi attaches to /confirmEmail. If that endpoint were ever removed or
            // renamed, /register would throw a 500 *after* committing the user row — so this
            // assertion is load-bearing for registration, not only for confirmation.
            var link = factory.ConfirmationLinks.Should().ContainSingle().Subject;
            link.Email.Should().Be(email);
            link.Credential.Should().Contain(ConfirmPath);

            using var confirm = await client.GetAsync(PathAndQuery(link.Credential));
            confirm.StatusCode.Should().Be(HttpStatusCode.OK);
            (await confirm.Content.ReadAsStringAsync()).Should().Contain("confirming your email");
        }

        [Fact]
        public async Task ConfirmEmail_RejectsATamperedCodeAndAnUnknownUser_TheSameWay()
        {
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"confirm-bad-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, email);
            var query = PathAndQuery(factory.ConfirmationLinks[0].Credential);

            using var tampered = await client.GetAsync(query[..^1] + (query[^1] == 'A' ? 'B' : 'A'));
            tampered.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            using var unknownUser = await client.GetAsync($"{ConfirmPath}?userId={Guid.NewGuid()}&code=abc");
            unknownUser.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            // An unknown user and a bad code are the same bare 401 — and neither is keyed on an
            // email address, so this endpoint is not a membership oracle at all.
            tampered.StatusCode.Should().Be(unknownUser.StatusCode);
            (await tampered.Content.ReadAsStringAsync())
                .Should().Be(await unknownUser.Content.ReadAsStringAsync());

            // Replaying a *valid* code, by contrast, succeeds again rather than being rejected:
            // ConfirmEmailAsync does not rotate the security stamp, so the token stays valid for its
            // lifetime. Asserted because it is Identity's real behaviour and reads as a bug
            // otherwise. It is harmless — the only effect is setting a flag that is already set.
            using var first = await client.GetAsync(query);
            first.StatusCode.Should().Be(HttpStatusCode.OK);
            using var replayed = await client.GetAsync(query);
            replayed.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task ResendConfirmationEmail_AnswersIdentically_ForKnownAndUnknownAddresses()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            var known = $"resend-known-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, known);
            var linksAfterRegister = factory.ConfirmationLinks.Count;

            var (knownResponse, knownBody, knownElapsed) = await PostResendAsync(client, known);
            var (unknownResponse, unknownBody, unknownElapsed) =
                await PostResendAsync(client, $"resend-unknown-{Guid.NewGuid()}@example.com");

            knownResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            unknownResponse.StatusCode.Should().Be(knownResponse.StatusCode);
            unknownBody.Should().Be(knownBody);

            AssertHeldToTheFloor(knownElapsed, unknownElapsed);

            // Exactly one extra link, for the address that exists.
            factory.ConfirmationLinks.Should().HaveCount(linksAfterRegister + 1);
            factory.ConfirmationLinks[^1].Email.Should().Be(known);

            knownResponse.Dispose();
            unknownResponse.Dispose();
        }

        [Fact]
        public async Task ResendConfirmationEmail_IsRateLimited_PerEmailAddress()
        {
            using var factory = new AccountRecoveryFactory(options =>
            {
                NoDelay(options);
                options.ResendsPerEmail = 1;
                options.ResendsPerAddress = 100;
            });
            using var client = factory.CreateClient();

            // Identity's /resendConfirmationEmail does not check IsEmailConfirmedAsync at all, so it
            // will mail a live confirmation link to any registered address on demand, confirmed or
            // not — and the address is chosen entirely by the caller. Unmetered that is a mail
            // cannon pointed at someone else's inbox. Identity ships no limit of its own.
            var email = $"resend-limit-{Guid.NewGuid()}@example.com";

            (await PostResendAsync(client, email)).Response.StatusCode.Should().Be(HttpStatusCode.OK);

            var refused = (await PostResendAsync(client, email)).Response;
            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            refused.Headers.RetryAfter.Should().NotBeNull();
            refused.Dispose();

            // A different address still has its own budget.
            (await PostResendAsync(client, $"resend-other-{Guid.NewGuid()}@example.com"))
                .Response.StatusCode.Should().Be(HttpStatusCode.OK);
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
        public async Task Register_IsRateLimited_PerClientAddress()
        {
            using var factory = new AccountRecoveryFactory(options =>
            {
                NoDelay(options);
                options.RegistrationsPerAddress = 1;
            });
            using var client = factory.CreateClient();

            using var first = await client.PostAsJsonAsync(
                RegisterPath,
                new { email = $"reg-limit-a-{Guid.NewGuid()}@example.com", password = Password });
            first.StatusCode.Should().Be(HttpStatusCode.OK);

            // Unauthenticated, creates rows, sends mail, and discloses whether an address is already
            // registered (see the enumeration note on issue #136). A limit does not fix the
            // disclosure but it bounds how fast the surface can be harvested.
            using var second = await client.PostAsJsonAsync(
                RegisterPath,
                new { email = $"reg-limit-b-{Guid.NewGuid()}@example.com", password = Password });
            second.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
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

        [Fact]
        public void EmailSender_ResolvesToTheUndeliveredStandIn_NotIdentitysSilentNoOp()
        {
            // Not AccountRecoveryFactory: that one substitutes a recording sender, which is exactly
            // what must not be under test here.
            using var factory = new AccountServiceFactory();
            using var scope = factory.Services.CreateScope();

            // Identity's AddApiEndpoints() TryAdds DefaultMessageEmailSender over NoOpEmailSender,
            // whose SendEmailAsync returns Task.CompletedTask. A service that registers nothing
            // therefore discards every confirmation link and reset code with a 200 and no log line —
            // which is what this one did before the recovery rework. The closed-generic registration
            // in Program.cs is what stops that, and this is the assertion that keeps it stopped.
            scope.ServiceProvider
                .GetRequiredService<IEmailSender<ApplicationUser>>()
                .Should().BeOfType<UndeliveredIdentityEmailSender>();
        }

        [Fact]
        public async Task UnconfirmedAccount_CanSignIn_WhileConfirmationIsNotRequired()
        {
            // The shipped default. It is deliberate and temporary: Identity issues its confirmation
            // link through IEmailSender<ApplicationUser>, and until #133 provisions a transactional
            // provider nothing can deliver it, so requiring confirmation today would mean nobody can
            // create a usable account at all.
            using var factory = new AccountRecoveryFactory(NoDelay);
            using var client = factory.CreateClient();

            var email = $"unconfirmed-signin-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, email);

            using var login = await client.PostAsJsonAsync("/account/login", new { email, password = Password });
            login.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task UnconfirmedAccount_CannotSignIn_WhenConfirmationIsRequired()
        {
            // The state the stakeholder ruling asks for, pinned now so turning it on is a
            // configuration change rather than another code change. #138 owns the flip.
            using var factory = new AccountRecoveryFactory(options =>
            {
                NoDelay(options);
                options.RequireConfirmedEmailToSignIn = true;
            });
            using var client = factory.CreateClient();

            var email = $"required-{Guid.NewGuid()}@example.com";
            await RegisterAsync(client, email);

            using var refused = await client.PostAsJsonAsync("/account/login", new { email, password = Password });
            refused.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            // Worth recording rather than hiding: Identity puts SignInResult.ToString() straight
            // into the problem detail, and PreSignInCheck returns NotAllowed *before* the password is
            // verified. So this response distinguishes a registered-but-unconfirmed address from an
            // unknown one for any password at all — a membership oracle that only exists once this
            // flag is on. Raised on issue #136 for a product ruling; asserted here so the day it
            // changes is a deliberate day.
            (await refused.Content.ReadAsStringAsync()).Should().Contain("NotAllowed");

            // Confirming the address makes the same credentials work.
            await ConfirmAsync(factory, client, email);
            using var allowed = await client.PostAsJsonAsync("/account/login", new { email, password = Password });
            allowed.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        private static void NoDelay(AccountRecoveryOptions options) =>
            options.MinimumResponseDuration = TimeSpan.Zero;

        /// <summary>
        /// Asserts that a found-an-account request and a found-nothing request were both held to the
        /// configured response floor, and to the same one.
        /// </summary>
        /// <remarks>
        /// <para>
        /// The floor is asserted with a tolerance rather than exactly, and the tolerance is not
        /// slop. <c>Task.Delay</c> schedules on the runtime's timer wheel, whose resolution is about
        /// 15ms on Windows, while the filter measures its elapsed time with <c>Stopwatch</c> (the
        /// high-resolution performance counter). The two clocks do not agree to the millisecond, so
        /// a pad asked for 250ms can land a few milliseconds short when measured by the other one.
        /// Asserting <c>&gt;= 250ms</c> literally makes this test fail a few runs in a hundred while
        /// the guarantee it is testing is perfectly intact — and a floor missed by 3ms leaks
        /// nothing.
        /// </para>
        /// <para>
        /// The second assertion is the one that actually states the security property: the two
        /// outcomes must not be distinguishable from each other. An unpadded handler answers the
        /// found-nothing case in single-digit milliseconds and the found-an-account case in
        /// noticeably more, so both assertions fail loudly if the filter stops padding.
        /// </para>
        /// </remarks>
        private static void AssertHeldToTheFloor(TimeSpan knownElapsed, TimeSpan unknownElapsed)
        {
            var floor = TimeSpan.FromMilliseconds(250);
            var tolerance = TimeSpan.FromMilliseconds(25);

            knownElapsed.Should().BeGreaterThanOrEqualTo(floor - tolerance);
            unknownElapsed.Should().BeGreaterThanOrEqualTo(floor - tolerance);

            (knownElapsed - unknownElapsed).Duration().Should().BeLessThan(floor);
        }

        /// <summary>Extracts the path and query from an absolute confirmation URL.</summary>
        private static string PathAndQuery(string absoluteUrl) => new Uri(absoluteUrl).PathAndQuery;

        private static async Task RegisterAsync(HttpClient client, string email)
        {
            using var response = await client.PostAsJsonAsync(RegisterPath, new { email, password = Password });
            response.EnsureSuccessStatusCode();
        }

        /// <summary>
        /// Confirms an already-registered address by following the link the service issued for it,
        /// exactly as the account holder's browser would.
        /// </summary>
        private static async Task ConfirmAsync(
            AccountRecoveryFactory factory,
            HttpClient client,
            string email)
        {
            var link = factory.ConfirmationLinks.Last(message => message.Email == email);

            using var response = await client.GetAsync(PathAndQuery(link.Credential));
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

        private static Task<(HttpResponseMessage Response, string Body, TimeSpan Elapsed)> PostResendAsync(
            HttpClient client,
            string email,
            string? realIp = null) =>
            PostTimedAsync(client, ResendPath, email, realIp);

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
