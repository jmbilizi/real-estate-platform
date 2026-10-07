// <copyright file="SignUpEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
using AccountService.Tests.Helpers;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for the sign-up endpoints under <c>/account/signup</c> (#652).
    /// </summary>
    /// <remarks>
    /// Each test owns a host, because the rate limiter counts per client address and per email.
    /// </remarks>
    public class SignUpEndpointTests
    {
        private const string StartPath = "/account/signup/start";
        private const string VerifyPath = "/account/signup/verify";
        private const string ResendPath = "/account/signup/resend";
        private const string ChangePath = "/account/signup/change-email";

        [Fact]
        public async Task Start_NewAddress_StoresAPendingRow_SendsACode_AndReturnsTheTimings()
        {
            var clock = new FakeClock();
            using var factory = new AccountRecoveryFactory(clock: clock);
            using var client = factory.CreateClient();
            var email = "  New.Person@Example.com ";

            var response = await Post(client, StartPath, new { email });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("resendAfterSeconds").GetInt32().Should().Be(60);
            body.GetProperty("expiresInSeconds").GetInt32().Should().Be(600);

            var row = (await Rows(factory)).Should().ContainSingle().Subject;
            row.Email.Should().Be("NEW.PERSON@EXAMPLE.COM");
            row.EmailAsEntered.Should().Be("New.Person@Example.com");
            row.State.Should().Be(PendingRegistrationState.AwaitingCode);
            row.ExpiresAt.Should().Be(clock.GetUtcNow().UtcDateTime.AddMinutes(30));
            row.ProofHash.Should().BeNull();

            var message = Codes(factory).Should().ContainSingle().Subject;
            message.To.Should().Be("New.Person@Example.com");
        }

        [Fact]
        public async Task Start_NormalizesTheAddress_SoCaseAndSpacesGiveOneRow()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();

            await Post(client, StartPath, new { email = "person@example.com" });
            await Post(client, StartPath, new { email = "  PERSON@Example.COM  " });

            (await Rows(factory)).Should().ContainSingle();
        }

        [Fact]
        public async Task Start_DoesNotCollapsePlusTagsOrDots()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();

            foreach (var email in new[] { "ab@example.com", "a.b@example.com", "ab+x@example.com", "ab+y@example.com" })
            {
                (await Post(client, StartPath, new { email })).StatusCode.Should().Be(HttpStatusCode.OK);
            }

            (await Rows(factory)).Should().HaveCount(4);
        }

        [Theory]
        [InlineData("")]
        [InlineData("nope")]
        [InlineData("a@b")]
        [InlineData("Name <a@example.com>")]
        [InlineData("a b@example.com")]
        public async Task Start_RefusesABadAddress_WithNoRowAndNoMessage(string email)
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, StartPath, new { email });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("invalid_email");
            (await Rows(factory)).Should().BeEmpty();
            factory.AlreadyRegisteredNotices.Should().BeEmpty();
        }

        [Fact]
        public async Task Start_AgainForTheSameAddress_RefreshesTheRow_AndVoidsTheOldCode()
        {
            var clock = new FakeClock();
            using var factory = NoCooldown(clock);
            using var client = factory.CreateClient();
            const string email = "again@example.com";

            await Post(client, StartPath, new { email });
            var first = CodeOf(factory);
            clock.Advance(TimeSpan.FromMinutes(5));
            await Post(client, StartPath, new { email });
            var second = CodeOf(factory);

            var row = (await Rows(factory)).Should().ContainSingle().Subject;
            row.ExpiresAt.Should().Be(clock.GetUtcNow().UtcDateTime.AddMinutes(30));
            (await Post(client, VerifyPath, new { email, code = first })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await Post(client, VerifyPath, new { email, code = second })).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Start_ExistingAccount_AnswersLikeANewAddress_CreatesNoRow_AndSendsTheNotice()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "taken@example.com");

            var known = await Post(client, StartPath, new { email = "Taken@Example.com" });
            var unknown = await Post(client, StartPath, new { email = "free@example.com" });

            known.StatusCode.Should().Be(unknown.StatusCode);
            (await known.Content.ReadAsStringAsync()).Should().Be(await unknown.Content.ReadAsStringAsync());
            (await Rows(factory)).Should().ContainSingle().Which.Email.Should().Be("FREE@EXAMPLE.COM");

            var sent = factory.AlreadyRegisteredNotices;
            sent.Should().ContainSingle(m => m.Kind == EmailKind.AlreadyRegistered).Which.To.Should().Be("Taken@Example.com");
            sent.Should().NotContain(m => m.Kind == EmailKind.Code && m.To.StartsWith("Taken", StringComparison.Ordinal));
        }

        [Fact]
        public async Task EveryStep_HoldsTheTimingFloor_ForNewAndExistingAddresses()
        {
            var floor = TimeSpan.FromMilliseconds(250);
            using var factory = new AccountRecoveryFactory(options => options.MinimumResponseDuration = floor);
            using var client = factory.CreateClient();
            foreach (var n in new[] { "taken1", "taken2", "taken3", "taken4" })
            {
                await CreateAccountAsync(factory, $"{n}@example.com");
            }

            foreach (var (path, body) in new (string, object)[]
            {
                (StartPath, new { email = "taken1@example.com" }),
                (StartPath, new { email = "free@example.com" }),
                (ResendPath, new { email = "taken2@example.com" }),
                (ResendPath, new { email = "free-r@example.com" }),
                (VerifyPath, new { email = "taken3@example.com", code = "123456" }),
                (VerifyPath, new { email = "free-v@example.com", code = "123456" }),
                (ChangePath, new { oldEmail = "taken4@example.com", newEmail = "taken4@example.com" }),
                (ChangePath, new { oldEmail = "x@example.com", newEmail = "free2@example.com" }),
            })
            {
                var watch = Stopwatch.StartNew();
                await Post(client, path, body);
                watch.Stop();

                watch.Elapsed.Should().BeGreaterThanOrEqualTo(floor - TimeSpan.FromMilliseconds(30), $"{path} must not answer faster than the floor");
            }
        }

        [Fact]
        public async Task Start_InsideTheCooldown_AnswersTooManyRequests_WithRetryAfter()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            await Post(client, StartPath, new { email = "fast@example.com" });
            var second = await Post(client, StartPath, new { email = "FAST@example.com" });

            second.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            int.Parse(second.Headers.GetValues("Retry-After").Single(), System.Globalization.CultureInfo.InvariantCulture)
                .Should().BeInRange(1, 60);
            Codes(factory).Should().ContainSingle();
        }

        [Fact]
        public async Task Verify_ARightCode_ReturnsAOneTimeProof_BoundToTheEmail()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "a@example.com" });
            var codeA = CodeOf(factory);
            await Post(client, StartPath, new { email = "b@example.com" });
            var codeB = CodeOf(factory);

            var proofA = await VerifyAsync(client, "a@example.com", codeA);
            var proofB = await VerifyAsync(client, "b@example.com", codeB);

            proofA.Should().NotBeNullOrWhiteSpace().And.NotBe(proofB);
            proofA!.Length.Should().BeGreaterThanOrEqualTo(43);
            var rows = await Rows(factory);
            rows.Should().OnlyContain(r => r.State == PendingRegistrationState.Verified && r.ProofHash != null);
            rows.Select(r => Convert.ToBase64String(r.ProofHash!)).Should().NotContain(proofA);

            // Bound to the email: A's proof does not open B's sign-up.
            (await Consume(factory, "b@example.com", proofA)).Should().BeFalse();
            (await Consume(factory, "a@example.com", proofB)).Should().BeFalse();
            (await Consume(factory, "A@Example.com", proofA)).Should().BeTrue();

            // Single use.
            (await Consume(factory, "a@example.com", proofA)).Should().BeFalse();
            (await Consume(factory, "b@example.com", proofB)).Should().BeTrue();
        }

        [Fact]
        public async Task Verify_TheBodyCarriesTheProofAndItsLife()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "a@example.com" });

            var response = await Post(client, VerifyPath, new { email = "a@example.com", code = CodeOf(factory) });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("signupProof").GetString().Should().NotBeNullOrWhiteSpace();
            body.GetProperty("expiresInSeconds").GetInt32().Should().Be(15 * 60);
        }

        [Fact]
        public async Task Verify_AProofWorksFor15Minutes_ThenStops()
        {
            var clock = new FakeClock();
            using var factory = NoCooldown(clock);
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "a@example.com" });
            var proof = await VerifyAsync(client, "a@example.com", CodeOf(factory));

            clock.Advance(TimeSpan.FromMinutes(14));
            (await Consume(factory, "a@example.com", proof)).Should().BeTrue();

            await Post(client, StartPath, new { email = "b@example.com" });
            var late = await VerifyAsync(client, "b@example.com", CodeOf(factory));
            clock.Advance(TimeSpan.FromMinutes(15) + TimeSpan.FromSeconds(1));
            (await Consume(factory, "b@example.com", late)).Should().BeFalse();
        }

        [Fact]
        public async Task Verify_ACodeWorksOnce()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "a@example.com" });
            var code = CodeOf(factory);

            (await Post(client, VerifyPath, new { email = "a@example.com", code })).StatusCode.Should().Be(HttpStatusCode.OK);
            var again = await Post(client, VerifyPath, new { email = "a@example.com", code });

            again.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task Verify_AWrongCode_ReturnsTheTriesLeft_ThenLocksWithRetryAfter()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "a@example.com" });
            var code = CodeOf(factory);

            var sequence = await WrongTriesAsync(client, "a@example.com", code);

            sequence.Should().Equal("400:4", "400:3", "400:2", "400:1", "429:900");

            // A right code does not open a locked email.
            var locked = await Post(client, VerifyPath, new { email = "a@example.com", code });
            locked.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            (await Rows(factory)).Single().State.Should().Be(PendingRegistrationState.AwaitingCode);
        }

        [Fact]
        public async Task Verify_AnswersTheSameForAPendingAnUnknownAndAnExistingAddress()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "taken@example.com");
            await Post(client, StartPath, new { email = "pending@example.com" });
            var code = CodeOf(factory);

            var pending = await WrongTriesAsync(client, "pending@example.com", code);
            var unknown = await WrongTriesAsync(client, "nobody@example.com", code);
            var existing = await WrongTriesAsync(client, "taken@example.com", code);

            unknown.Should().Equal(pending);
            existing.Should().Equal(pending);
        }

        [Fact]
        public async Task Verify_AnExpiredCode_IsAWrongTry_NotADistinctAnswer()
        {
            var clock = new FakeClock();
            using var factory = NoCooldown(clock);
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "a@example.com" });
            var code = CodeOf(factory);

            clock.Advance(TimeSpan.FromMinutes(11));
            var response = await Post(client, VerifyPath, new { email = "a@example.com", code });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("attemptsLeft").GetInt32().Should().Be(4);
        }

        [Fact]
        public async Task Verify_RefusesABadAddress()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, VerifyPath, new { email = "nope", code = "123456" });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("invalid_email");
        }

        [Fact]
        public async Task Resend_IssuesANewCode_AndVoidsTheOldOne()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            const string email = "a@example.com";
            await Post(client, StartPath, new { email });
            var first = CodeOf(factory);

            var response = await Post(client, ResendPath, new { email });
            var second = CodeOf(factory);

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            Codes(factory).Should().HaveCount(2);
            (await Post(client, VerifyPath, new { email, code = first })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await Post(client, VerifyPath, new { email, code = second })).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Resend_ObeysTheCooldown()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "a@example.com" });

            var response = await Post(client, ResendPath, new { email = "a@example.com" });

            response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            response.Headers.Contains("Retry-After").Should().BeTrue();
            Codes(factory).Should().ContainSingle();
        }

        [Fact]
        public async Task Resend_ObeysTheHourlyCap_AndTheEngineCapAlone()
        {
            using var factory = new AccountRecoveryFactory(configureCodes: c =>
            {
                c.ResendCooldown = TimeSpan.Zero;
                c.MaxPerHour = 2;
                c.MaxPerDay = 3;
            });
            using var client = factory.CreateClient();
            const string email = "a@example.com";

            (await Post(client, StartPath, new { email })).StatusCode.Should().Be(HttpStatusCode.OK);
            (await Post(client, ResendPath, new { email })).StatusCode.Should().Be(HttpStatusCode.OK);
            var third = await Post(client, ResendPath, new { email });

            third.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            Codes(factory).Should().HaveCount(2);

            // The engine enforces the same cap when the per-process counters are empty (a restart,
            // or another replica).
            using var scope = factory.Services.CreateScope();
            var engine = scope.ServiceProvider.GetRequiredService<EmailCodeService>();
            (await engine.IssueAsync(email, EmailCodePurpose.SignUp)).Status.Should().Be(EmailCodeIssueStatus.Throttled);
        }

        [Fact]
        public async Task Resend_ForAnUnknownOrExistingAddress_AnswersLikeAPendingOne_AndSendsNothing()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "taken@example.com");
            await Post(client, StartPath, new { email = "pending@example.com" });
            var sentBefore = factory.AlreadyRegisteredNotices.Count;

            var pending = await Post(client, ResendPath, new { email = "pending@example.com" });
            var unknown = await Post(client, ResendPath, new { email = "nobody@example.com" });
            var existing = await Post(client, ResendPath, new { email = "taken@example.com" });

            unknown.StatusCode.Should().Be(pending.StatusCode);
            existing.StatusCode.Should().Be(pending.StatusCode);
            var expected = await pending.Content.ReadAsStringAsync();
            (await unknown.Content.ReadAsStringAsync()).Should().Be(expected);
            (await existing.Content.ReadAsStringAsync()).Should().Be(expected);
            factory.AlreadyRegisteredNotices.Skip(sentBefore).Should().ContainSingle().Which.To.Should().Be("pending@example.com");
            (await Rows(factory)).Should().ContainSingle();
        }

        [Fact]
        public async Task Resend_ForAnExpiredSignUp_SendsNothing()
        {
            var clock = new FakeClock();
            using var factory = NoCooldown(clock);
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "a@example.com" });
            clock.Advance(TimeSpan.FromMinutes(31));

            var response = await Post(client, ResendPath, new { email = "a@example.com" });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            Codes(factory).Should().ContainSingle();
        }

        [Fact]
        public async Task ChangeEmail_DropsTheOldRow_VoidsItsCode_AndStartsTheNewAddress()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "typo@example.com" });
            var oldCode = CodeOf(factory);

            var response = await Post(client, ChangePath, new { oldEmail = "typo@example.com", newEmail = "Right@Example.com" });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("resendAfterSeconds").GetInt32().Should().Be(0);
            body.GetProperty("expiresInSeconds").GetInt32().Should().Be(600);
            (await Rows(factory)).Should().ContainSingle().Which.Email.Should().Be("RIGHT@EXAMPLE.COM");
            Codes(factory).Last().To.Should().Be("Right@Example.com");

            // The old code is dead and the old address has no sign-up left.
            (await Post(client, VerifyPath, new { email = "typo@example.com", code = oldCode })).StatusCode
                .Should().Be(HttpStatusCode.BadRequest);
            using var scope = factory.Services.CreateScope();
            var engine = scope.ServiceProvider.GetRequiredService<EmailCodeService>();
            (await engine.VerifyAsync("typo@example.com", EmailCodePurpose.SignUp, oldCode)).Status
                .Should().Be(EmailCodeVerifyStatus.Invalid);
            (await Post(client, VerifyPath, new { email = "right@example.com", code = CodeOf(factory) })).StatusCode
                .Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task ChangeEmail_TheOldAddressNeverBecomesAnAccount()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "typo@example.com" });
            var oldCode = CodeOf(factory);

            await Post(client, ChangePath, new { oldEmail = "typo@example.com", newEmail = "right@example.com" });

            // The old address can neither verify nor hold a proof.
            (await VerifyAsync(client, "typo@example.com", oldCode)).Should().BeNull();
            (await Rows(factory)).Should().ContainSingle().Which.Email.Should().Be("RIGHT@EXAMPLE.COM");
            using var scope = factory.Services.CreateScope();
            (await scope.ServiceProvider.GetRequiredService<AccountDbContext>().Users.CountAsync()).Should().Be(0);
        }

        [Fact]
        public async Task ChangeEmail_AnswersTheSame_WhetherTheOldRowExistsOrNot()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "known@example.com" });

            var known = await Post(client, ChangePath, new { oldEmail = "known@example.com", newEmail = "n1@example.com" });
            var unknown = await Post(client, ChangePath, new { oldEmail = "nobody@example.com", newEmail = "n2@example.com" });

            unknown.StatusCode.Should().Be(known.StatusCode);
            (await unknown.Content.ReadAsStringAsync()).Should().Be(await known.Content.ReadAsStringAsync());
        }

        [Fact]
        public async Task ChangeEmail_ToAnAddressWithAnAccount_SendsTheNotice_AndKeepsNoRowForIt()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "taken@example.com");
            await Post(client, StartPath, new { email = "typo@example.com" });

            var response = await Post(client, ChangePath, new { oldEmail = "typo@example.com", newEmail = "taken@example.com" });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await Rows(factory)).Should().BeEmpty();
            factory.AlreadyRegisteredNotices.Should().ContainSingle(m => m.Kind == EmailKind.AlreadyRegistered);
        }

        [Fact]
        public async Task ChangeEmail_ToTheSameAddress_ActsAsStart_AndKeepsTheRow()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "a@example.com" });

            var response = await Post(client, ChangePath, new { oldEmail = "a@example.com", newEmail = "A@EXAMPLE.com" });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await Rows(factory)).Should().ContainSingle();
            (await Post(client, VerifyPath, new { email = "a@example.com", code = CodeOf(factory) })).StatusCode
                .Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task ChangeEmail_RefusesABadAddress_AndKeepsTheOldRow()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "a@example.com" });

            var response = await Post(client, ChangePath, new { oldEmail = "a@example.com", newEmail = "nope" });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await Rows(factory)).Should().ContainSingle().Which.Email.Should().Be("A@EXAMPLE.COM");
        }

        [Fact]
        public async Task NoStep_CreatesOrChangesAnAccountRow()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "taken@example.com");
            var before = await Accounts(factory);

            await Post(client, StartPath, new { email = "new@example.com" });
            await Post(client, StartPath, new { email = "taken@example.com" });
            await VerifyAsync(client, "new@example.com", CodeOf(factory));
            await Post(client, ResendPath, new { email = "new@example.com" });
            await Post(client, ResendPath, new { email = "taken@example.com" });
            await Post(client, VerifyPath, new { email = "taken@example.com", code = "123456" });
            await Post(client, ChangePath, new { oldEmail = "new@example.com", newEmail = "other@example.com" });
            await Post(client, ChangePath, new { oldEmail = "other@example.com", newEmail = "taken@example.com" });

            (await Accounts(factory)).Should().Equal(before);
        }

        [Fact]
        public async Task Start_ForAVerifiedAddress_LeavesTheLiveProofAlone_AndAnswersTheSame()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            const string email = "a@example.com";
            var first = await Post(client, StartPath, new { email });
            var proof = await VerifyAsync(client, email, CodeOf(factory));
            var codesBefore = Codes(factory).Count;

            // Anyone who knows the address can call start. It must not void the owner's proof.
            var again = await Post(client, StartPath, new { email });

            again.StatusCode.Should().Be(HttpStatusCode.OK);
            (await again.Content.ReadAsStringAsync()).Should().Be(await first.Content.ReadAsStringAsync());
            Codes(factory).Should().HaveCount(codesBefore);
            (await Rows(factory)).Single().State.Should().Be(PendingRegistrationState.Verified);
            (await Consume(factory, email, proof)).Should().BeTrue();

            // Once the proof is used up, a start begins again.
            await Post(client, StartPath, new { email });
            (await Rows(factory)).Single().State.Should().Be(PendingRegistrationState.AwaitingCode);
            Codes(factory).Should().HaveCount(codesBefore + 1);
        }

        [Fact]
        public async Task Start_AfterTheProofExpires_BeginsAgain()
        {
            var clock = new FakeClock();
            using var factory = NoCooldown(clock);
            using var client = factory.CreateClient();
            const string email = "a@example.com";
            await Post(client, StartPath, new { email });
            await VerifyAsync(client, email, CodeOf(factory));
            var codesBefore = Codes(factory).Count;
            clock.Advance(TimeSpan.FromMinutes(16));

            await Post(client, StartPath, new { email });

            Codes(factory).Should().HaveCount(codesBefore + 1);
            (await Rows(factory)).Single().State.Should().Be(PendingRegistrationState.AwaitingCode);
        }

        [Fact]
        public async Task ChangeEmail_LeavesAVerifiedRowAlone()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "victim@example.com" });
            var proof = await VerifyAsync(client, "victim@example.com", CodeOf(factory));

            var response = await Post(client, ChangePath, new { oldEmail = "victim@example.com", newEmail = "attacker@example.com" });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await Rows(factory)).Select(r => r.Email).Should().BeEquivalentTo("VICTIM@EXAMPLE.COM", "ATTACKER@EXAMPLE.COM");
            (await Consume(factory, "victim@example.com", proof)).Should().BeTrue();
        }

        [Fact]
        public async Task ABadAddress_SpendsNoEmailCounter()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            for (var i = 0; i < 3; i++)
            {
                (await Post(client, StartPath, new { email = string.Empty })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
                (await Post(client, ResendPath, new { email = "   " })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
                (await Post(client, ChangePath, new { oldEmail = string.Empty, newEmail = string.Empty })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            }
        }

        [Fact]
        public async Task Start_AfterALock_AnswersTooManyRequests_ForPendingUnknownAndExistingAlike()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "taken@example.com");
            await Post(client, StartPath, new { email = "pending@example.com" });
            var code = CodeOf(factory);
            var seen = new List<(HttpStatusCode Status, int RetryAfter)>();

            foreach (var email in new[] { "pending@example.com", "nobody@example.com", "taken@example.com" })
            {
                await WrongTriesAsync(client, email, code);
                var response = await Post(client, StartPath, new { email });
                seen.Add((response.StatusCode, int.Parse(response.Headers.GetValues("Retry-After").Single(), System.Globalization.CultureInfo.InvariantCulture)));
            }

            seen.Should().OnlyContain(s => s.Status == HttpStatusCode.TooManyRequests && s.RetryAfter >= 890 && s.RetryAfter <= 900);
        }

        [Fact]
        public async Task Purge_DeletesExpiredRows_AndKeepsLiveOnes()
        {
            var clock = new FakeClock();
            using var factory = NoCooldown(clock);
            using var client = factory.CreateClient();
            await Post(client, StartPath, new { email = "old@example.com" });
            clock.Advance(TimeSpan.FromMinutes(20));
            await Post(client, StartPath, new { email = "young@example.com" });
            clock.Advance(TimeSpan.FromMinutes(11));

            using var scope = factory.Services.CreateScope();
            var removed = await scope.ServiceProvider.GetRequiredService<SignUpService>().PurgeAsync();

            removed.Should().Be(1);
            (await Rows(factory)).Should().ContainSingle().Which.Email.Should().Be("YOUNG@EXAMPLE.COM");
        }

        [Fact]
        public void TheHost_RunsThePendingRegistrationPurge()
        {
            using var factory = new AccountRecoveryFactory();

            factory.Services.GetServices<IHostedService>().Should().ContainSingle(s => s is PendingRegistrationPurgeService);
        }

        [Fact]
        public void ThePendingRegistrationTable_HasAUniqueEmailIndex_AndNoPasswordColumn()
        {
            using var factory = new AccountRecoveryFactory();
            using var scope = factory.Services.CreateScope();
            var entity = scope.ServiceProvider.GetRequiredService<AccountDbContext>()
                .Model.FindEntityType(typeof(PendingRegistration))!;

            entity.GetIndexes().Should().Contain(i => i.IsUnique && i.Properties.Single().Name == nameof(PendingRegistration.Email));
            entity.GetProperties().Select(p => p.Name).Should().NotContain(n => n.Contains("Password", StringComparison.OrdinalIgnoreCase));
        }

        [Fact]
        public async Task SendLimits_CountPerClientAddress_AcrossEmails()
        {
            using var factory = new AccountRecoveryFactory(options => options.SignUpSendsPerAddress = 3);
            using var client = factory.CreateClient();

            for (var i = 0; i < 3; i++)
            {
                (await Post(client, StartPath, new { email = $"u{i}@example.com" }, "10.1.1.1")).StatusCode
                    .Should().Be(HttpStatusCode.OK);
            }

            var refused = await Post(client, StartPath, new { email = "u9@example.com" }, "10.1.1.1");
            var resend = await Post(client, ResendPath, new { email = "u0@example.com" }, "10.1.1.1");
            var other = await Post(client, StartPath, new { email = "u9@example.com" }, "10.1.1.2");

            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            refused.Headers.Contains("Retry-After").Should().BeTrue();
            resend.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            other.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task SendLimits_CountPerEmail_WhateverTheClientAddress()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            (await Post(client, StartPath, new { email = "victim@example.com" }, "10.1.1.1")).StatusCode.Should().Be(HttpStatusCode.OK);
            var second = await Post(client, StartPath, new { email = "victim@example.com" }, "10.1.1.2");

            second.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        }

        [Fact]
        public async Task VerifyLimit_CountsPerClientAddress_SoOneAddressCannotLockManyEmails()
        {
            using var factory = new AccountRecoveryFactory(options => options.SignUpVerifiesPerAddress = 3);
            using var client = factory.CreateClient();

            for (var i = 0; i < 3; i++)
            {
                (await Post(client, VerifyPath, new { email = $"u{i}@example.com", code = "123456" }, "10.1.1.1")).StatusCode
                    .Should().Be(HttpStatusCode.BadRequest);
            }

            var refused = await Post(client, VerifyPath, new { email = "u9@example.com", code = "123456" }, "10.1.1.1");
            var other = await Post(client, VerifyPath, new { email = "u9@example.com", code = "123456" }, "10.1.1.2");

            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            other.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task ChangeEmailLimit_CountsTheOldEmail_SoAVictimsSignUpCannotBeDroppedAtWill()
        {
            using var factory = new AccountRecoveryFactory(
                options => options.RequestsPerEmail = 2,
                c => c.ResendCooldown = TimeSpan.Zero);
            using var client = factory.CreateClient();

            (await Post(client, ChangePath, new { oldEmail = "victim@example.com", newEmail = "a@example.com" })).StatusCode.Should().Be(HttpStatusCode.OK);
            (await Post(client, ChangePath, new { oldEmail = "victim@example.com", newEmail = "b@example.com" })).StatusCode.Should().Be(HttpStatusCode.OK);
            var third = await Post(client, ChangePath, new { oldEmail = "VICTIM@example.com", newEmail = "c@example.com" });

            third.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        }

        [Fact]
        public async Task WithNoCodeKey_EveryStepAnswersServiceUnavailable_ForNewAndExistingAddresses()
        {
            using var factory = new AccountRecoveryFactory(configureCodes: c => c.HmacKey = string.Empty);
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "taken@example.com");

            foreach (var (path, body) in new (string, object)[]
            {
                (StartPath, new { email = "free@example.com" }),
                (StartPath, new { email = "taken@example.com" }),
                (ResendPath, new { email = "free-r@example.com" }),
                (VerifyPath, new { email = "free-v@example.com", code = "123456" }),
                (ChangePath, new { oldEmail = "a@example.com", newEmail = "free-c@example.com" }),
            })
            {
                (await Post(client, path, body)).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable, path);
            }

            (await Rows(factory)).Should().BeEmpty();
            factory.AlreadyRegisteredNotices.Should().BeEmpty();
        }

        [Fact]
        public async Task NothingLogsTheEmailOrTheCode()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            const string email = "secret.person@example.com";
            await CreateAccountAsync(factory, "taken-secret@example.com");

            await Post(client, StartPath, new { email });
            var code = CodeOf(factory);
            await Post(client, VerifyPath, new { email, code = code == "000000" ? "000001" : "000000" });
            await Post(client, ResendPath, new { email });
            var fresh = CodeOf(factory);
            var proof = await VerifyAsync(client, email, fresh);
            await Post(client, StartPath, new { email = "taken-secret@example.com" });
            await Post(client, ChangePath, new { oldEmail = email, newEmail = "moved.person@example.com" });

            var logged = string.Join("\n", factory.Logs.Entries.Select(e => e.Message));
            logged.Should().NotContainEquivalentOf("secret.person");
            logged.Should().NotContainEquivalentOf("taken-secret");
            logged.Should().NotContainEquivalentOf("moved.person");
            System.Text.RegularExpressions.Regex.IsMatch(logged, $@"\b({code}|{fresh})\b").Should().BeFalse();
            logged.Should().NotContain(proof!);
        }

        private static AccountRecoveryFactory NoCooldown(TimeProvider? clock = null) =>
            new(
                configureCodes: c =>
                {
                    c.ResendCooldown = TimeSpan.Zero;
                    c.MaxPerHour = 100;
                    c.MaxPerDay = 100;
                },
                clock: clock);

        private static async Task<HttpResponseMessage> Post(HttpClient client, string path, object body, string? address = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
            if (address is not null)
            {
                request.Headers.Add("X-Real-IP", address);
            }

            return await client.SendAsync(request);
        }

        private static List<OutboundEmail> Codes(AccountRecoveryFactory factory) =>
            factory.AlreadyRegisteredNotices.Where(m => m.Kind == EmailKind.Code).ToList();

        private static string CodeOf(AccountRecoveryFactory factory) => Codes(factory).Last().Subject.Split(' ')[0];

        private static async Task<string?> VerifyAsync(HttpClient client, string email, string code)
        {
            var response = await Post(client, VerifyPath, new { email, code });
            if (response.StatusCode != HttpStatusCode.OK)
            {
                return null;
            }

            return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("signupProof").GetString();
        }

        private static async Task<List<string>> WrongTriesAsync(HttpClient client, string email, string realCode)
        {
            var wrong = realCode == "000000" ? "000001" : "000000";
            var result = new List<string>();
            for (var i = 0; i < 5; i++)
            {
                var response = await Post(client, VerifyPath, new { email, code = wrong });
                if (response.StatusCode == HttpStatusCode.BadRequest)
                {
                    var left = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("attemptsLeft").GetInt32();
                    result.Add($"400:{left}");
                }
                else
                {
                    var retry = int.Parse(response.Headers.GetValues("Retry-After").Single(), System.Globalization.CultureInfo.InvariantCulture);
                    result.Add($"{(int)response.StatusCode}:{retry}");
                }
            }

            return result;
        }

        private static async Task<List<PendingRegistration>> Rows(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>()
                .PendingRegistrations.AsNoTracking().ToListAsync();
        }

        private static async Task<List<string>> Accounts(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            var users = await scope.ServiceProvider.GetRequiredService<AccountDbContext>()
                .Users.AsNoTracking().ToListAsync();
            return users.Select(u => $"{u.Id}|{u.Email}|{u.EmailConfirmed}|{u.SecurityStamp}|{u.PasswordHash}").OrderBy(s => s, StringComparer.Ordinal).ToList();
        }

        private static async Task<bool> Consume(AccountRecoveryFactory factory, string email, string? proof)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<SignUpService>().TryConsumeProofAsync(email, proof);
        }

        private static async Task CreateAccountAsync(AccountRecoveryFactory factory, string email)
        {
            using var scope = factory.Services.CreateScope();
            var manager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var result = await manager.CreateAsync(
                new ApplicationUser { UserName = email, Email = email, EmailConfirmed = true },
                "Test1234!@#Abcd");
            result.Succeeded.Should().BeTrue();
        }
    }
}
