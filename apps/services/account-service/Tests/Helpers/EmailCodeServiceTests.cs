// <copyright file="EmailCodeServiceTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Unit tests for <see cref="EmailCodeService"/> and <see cref="EmailCodeOptions"/>, on an
    /// in-memory database and a clock the test moves.
    /// </summary>
    public sealed class EmailCodeServiceTests : IDisposable
    {
        private const string Email = "Person@Example.com";

        private readonly string dbName = Guid.NewGuid().ToString();
        private readonly FakeClock clock = new();
        private readonly Sender sender = new();
        private readonly AccountDbContext db;
        private readonly EmailCodeOptions settings = new() { HmacKey = EmailCodeOptions.DevelopmentKey };
        private readonly EmailCodeService service;

        /// <summary>Initializes a new instance of the <see cref="EmailCodeServiceTests"/> class.</summary>
        public EmailCodeServiceTests()
        {
            this.db = new AccountDbContext(new DbContextOptionsBuilder<AccountDbContext>()
                .UseInMemoryDatabase(this.dbName)
                .Options);
            this.service = this.NewService();
        }

        /// <inheritdoc/>
        public void Dispose() => this.db.Dispose();

        [Fact]
        public async Task Issue_StoresAHashNeverTheCode_AndSendsTheCodeOnce()
        {
            var result = await this.service.IssueAsync(Email, EmailCodePurpose.SignUp, "user-1");

            result.Status.Should().Be(EmailCodeIssueStatus.Issued);
            var code = this.sender.LastCode;
            code.Should().MatchRegex("^[0-9]{6}$");
            this.sender.Messages.Should().ContainSingle().Which.To.Should().Be(Email);
            var row = await this.db.EmailCodes.SingleAsync();
            row.Email.Should().Be("PERSON@EXAMPLE.COM");
            row.CodeHash.Should().HaveCount(32);
            Convert.ToHexString(row.CodeHash).Should().NotContain(code);
            row.UserId.Should().Be("user-1");
            row.ExpiresAt.Should().Be(this.clock.GetUtcNow().UtcDateTime.AddMinutes(10));
        }

        [Fact]
        public async Task Verify_AcceptsTheRightCode_ThenRefusesItAgain()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp, "user-1");
            var code = this.sender.LastCode;

            var first = await this.service.VerifyAsync("person@example.com", EmailCodePurpose.SignUp, code);
            var second = await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, code);

            first.Status.Should().Be(EmailCodeVerifyStatus.Verified);
            first.UserId.Should().Be("user-1");
            second.Status.Should().Be(EmailCodeVerifyStatus.Invalid);
        }

        [Fact]
        public async Task Verify_RefusesAnExpiredCode()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var code = this.sender.LastCode;
            this.clock.Advance(TimeSpan.FromMinutes(10));

            var result = await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, code);

            result.Status.Should().Be(EmailCodeVerifyStatus.Invalid);
        }

        [Fact]
        public async Task Verify_AcceptsACodeJustBeforeItExpires()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var code = this.sender.LastCode;
            this.clock.Advance(TimeSpan.FromMinutes(10) - TimeSpan.FromSeconds(1));

            var result = await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, code);

            result.Status.Should().Be(EmailCodeVerifyStatus.Verified);
        }

        [Fact]
        public async Task Verify_RefusesACodeIssuedForAnotherPurposeOrEmail()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var code = this.sender.LastCode;

            (await this.service.VerifyAsync(Email, EmailCodePurpose.PasswordReset, code)).Status
                .Should().Be(EmailCodeVerifyStatus.Invalid);
            (await this.service.VerifyAsync("other@example.com", EmailCodePurpose.SignUp, code)).Status
                .Should().Be(EmailCodeVerifyStatus.Invalid);
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("12")]
        [InlineData("abcdef")]
        public async Task Verify_TreatsAMalformedCodeAsAWrongTry(string? submitted)
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);

            var result = await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, submitted);

            result.Status.Should().Be(EmailCodeVerifyStatus.Invalid);
            (await this.db.EmailCodeThrottles.SingleAsync()).FailedAttempts.Should().Be(1);
        }

        [Fact]
        public async Task Issue_VoidsEveryEarlierOpenCode_ForThatEmailAndPurposeOnly()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var first = this.sender.LastCode;
            await this.service.IssueAsync(Email, EmailCodePurpose.PasswordReset);
            var otherPurpose = this.sender.LastCode;
            this.clock.Advance(TimeSpan.FromSeconds(61));
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var second = this.sender.LastCode;

            (await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, first)).Status
                .Should().Be(EmailCodeVerifyStatus.Invalid);
            (await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, second)).Status
                .Should().Be(EmailCodeVerifyStatus.Verified);
            (await this.service.VerifyAsync(Email, EmailCodePurpose.PasswordReset, otherPurpose)).Status
                .Should().Be(EmailCodeVerifyStatus.Verified);
        }

        [Fact]
        public async Task Invalidate_VoidsTheOpenCode()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var code = this.sender.LastCode;

            await this.service.InvalidateAsync(Email, EmailCodePurpose.SignUp);

            (await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, code)).Status
                .Should().Be(EmailCodeVerifyStatus.Invalid);
        }

        [Fact]
        public async Task Verify_FiveWrongTriesLockTheEmailAndPurpose_EvenAgainstTheRightCode()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var code = this.sender.LastCode;

            for (var i = 0; i < 4; i++)
            {
                (await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, Wrong(code))).Status
                    .Should().Be(EmailCodeVerifyStatus.Invalid);
            }

            var fifth = await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, Wrong(code));
            var rightButLocked = await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, code);

            fifth.Status.Should().Be(EmailCodeVerifyStatus.Locked);
            fifth.RetryAfterSeconds.Should().Be(15 * 60);
            rightButLocked.Status.Should().Be(EmailCodeVerifyStatus.Locked);
            rightButLocked.RetryAfterSeconds.Should().BeInRange(1, 15 * 60);
        }

        [Fact]
        public async Task Verify_ReportsTheTriesLeft_OnACountedWrongTry_AndNullWhenNoCodeIsOpen()
        {
            (await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, "123456")).AttemptsLeft.Should().BeNull();

            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var wrong = Wrong(this.sender.LastCode);

            var left = new List<int?>();
            for (var i = 0; i < 4; i++)
            {
                left.Add((await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, wrong)).AttemptsLeft);
            }

            left.Should().Equal(4, 3, 2, 1);
            (await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, wrong)).Status.Should().Be(EmailCodeVerifyStatus.Locked);
        }

        [Fact]
        public async Task Verify_TheLockIsPerPurpose_AndEndsAfterFifteenMinutes()
        {
            await this.LockAsync(EmailCodePurpose.SignUp);
            await this.service.IssueAsync(Email, EmailCodePurpose.PasswordReset);
            var resetCode = this.sender.LastCode;

            (await this.service.VerifyAsync(Email, EmailCodePurpose.PasswordReset, resetCode)).Status
                .Should().Be(EmailCodeVerifyStatus.Verified);

            this.clock.Advance(TimeSpan.FromMinutes(15));
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var fresh = this.sender.LastCode;
            (await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, fresh)).Status
                .Should().Be(EmailCodeVerifyStatus.Verified);
        }

        [Fact]
        public async Task Verify_AfterTheLockEnds_TheCountStartsAgain()
        {
            await this.LockAsync(EmailCodePurpose.SignUp);
            this.clock.Advance(TimeSpan.FromMinutes(15));
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var code = this.sender.LastCode;

            var wrong = await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, Wrong(code));

            wrong.Status.Should().Be(EmailCodeVerifyStatus.Invalid);
            (await this.db.EmailCodeThrottles.SingleAsync()).FailedAttempts.Should().Be(1);
        }

        [Fact]
        public async Task Issue_WhileLocked_ReturnsLockedWithRetryAfter_AndSendsNothing()
        {
            await this.LockAsync(EmailCodePurpose.SignUp);
            this.sender.Messages.Clear();
            this.clock.Advance(TimeSpan.FromMinutes(2));

            var result = await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);

            result.Status.Should().Be(EmailCodeIssueStatus.Locked);
            result.RetryAfterSeconds.Should().Be(13 * 60);
            this.sender.Messages.Should().BeEmpty();
        }

        [Fact]
        public async Task Verify_WrongTriesSurviveAResend()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var first = this.sender.LastCode;
            for (var i = 0; i < 3; i++)
            {
                await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, Wrong(first));
            }

            this.clock.Advance(TimeSpan.FromSeconds(61));
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var second = this.sender.LastCode;

            (await this.db.EmailCodeThrottles.SingleAsync()).FailedAttempts.Should().Be(3);
            (await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, Wrong(second))).Status
                .Should().Be(EmailCodeVerifyStatus.Invalid);
            (await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, Wrong(second))).Status
                .Should().Be(EmailCodeVerifyStatus.Locked);
        }

        [Fact]
        public async Task Verify_ACorrectCodeClearsTheCount()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var code = this.sender.LastCode;
            await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, Wrong(code));
            await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, Wrong(code));

            (await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, code)).Status
                .Should().Be(EmailCodeVerifyStatus.Verified);

            (await this.db.EmailCodeThrottles.CountAsync()).Should().Be(0);
        }

        [Fact]
        public async Task Verify_WrongTriesAgeOutAfterTheFailureWindow()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var code = this.sender.LastCode;
            for (var i = 0; i < 4; i++)
            {
                await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, Wrong(code));
            }

            this.clock.Advance(TimeSpan.FromDays(1));
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);

            var result = await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, Wrong(this.sender.LastCode));

            result.Status.Should().Be(EmailCodeVerifyStatus.Invalid);
            (await this.db.EmailCodeThrottles.SingleAsync()).FailedAttempts.Should().Be(1);
        }

        [Fact]
        public async Task Issue_RefusesInsideTheSixtySecondCooldown_WithTheSecondsLeft()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            this.clock.Advance(TimeSpan.FromSeconds(20));

            var result = await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);

            result.Status.Should().Be(EmailCodeIssueStatus.Throttled);
            result.RetryAfterSeconds.Should().Be(40);
            this.sender.Messages.Should().ContainSingle();

            this.clock.Advance(TimeSpan.FromSeconds(40));
            (await this.service.IssueAsync(Email, EmailCodePurpose.SignUp)).Status
                .Should().Be(EmailCodeIssueStatus.Issued);
        }

        [Fact]
        public async Task Issue_RefusesTheSixthCodeInAnHour_UntilTheOldestLeavesTheWindow()
        {
            for (var i = 0; i < 5; i++)
            {
                (await this.service.IssueAsync(Email, EmailCodePurpose.SignUp)).Status
                    .Should().Be(EmailCodeIssueStatus.Issued);
                this.clock.Advance(TimeSpan.FromMinutes(2));
            }

            var sixth = await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);

            sixth.Status.Should().Be(EmailCodeIssueStatus.Throttled);
            sixth.RetryAfterSeconds.Should().Be(50 * 60);

            this.clock.Advance(TimeSpan.FromSeconds(sixth.RetryAfterSeconds));
            (await this.service.IssueAsync(Email, EmailCodePurpose.SignUp)).Status
                .Should().Be(EmailCodeIssueStatus.Issued);
        }

        [Fact]
        public async Task Issue_RefusesTheEleventhCodeInADay()
        {
            // Five per hour, spaced so the hourly cap never applies: 10 codes at 20 minute gaps is
            // 3 per hour.
            for (var i = 0; i < 10; i++)
            {
                (await this.service.IssueAsync(Email, EmailCodePurpose.SignUp)).Status
                    .Should().Be(EmailCodeIssueStatus.Issued);
                this.clock.Advance(TimeSpan.FromMinutes(20));
            }

            var eleventh = await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);

            eleventh.Status.Should().Be(EmailCodeIssueStatus.Throttled);
            eleventh.RetryAfterSeconds.Should().BeGreaterThan(0);
            this.sender.Messages.Should().HaveCount(10);

            // Another email and another purpose keep their own budgets.
            (await this.service.IssueAsync("other@example.com", EmailCodePurpose.SignUp)).Status
                .Should().Be(EmailCodeIssueStatus.Issued);
            (await this.service.IssueAsync(Email, EmailCodePurpose.PasswordReset)).Status
                .Should().Be(EmailCodeIssueStatus.Issued);
        }

        [Fact]
        public async Task Purge_RemovesSpentCodesOnlyAfterTheDailyWindow_AndKeepsOpenOnes()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var code = this.sender.LastCode;
            await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, code);

            (await this.service.PurgeAsync()).Should().Be(0);
            (await this.db.EmailCodes.CountAsync()).Should().Be(1);

            this.clock.Advance(TimeSpan.FromDays(1) + TimeSpan.FromSeconds(1));
            await this.service.IssueAsync(Email, EmailCodePurpose.PasswordReset);

            (await this.service.PurgeAsync()).Should().Be(1);
            var left = await this.db.EmailCodes.SingleAsync();
            left.Purpose.Should().Be(EmailCodePurpose.PasswordReset);
        }

        [Fact]
        public async Task Purge_RemovesExpiredCodes_AndStaleThrottleRows_ButNotActiveLocks()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, Wrong(this.sender.LastCode));
            await this.LockAsync(EmailCodePurpose.PasswordReset);

            this.clock.Advance(TimeSpan.FromDays(1) + TimeSpan.FromSeconds(1));

            (await this.service.PurgeAsync()).Should().Be(4);
            (await this.db.EmailCodes.CountAsync()).Should().Be(0);
            (await this.db.EmailCodeThrottles.CountAsync()).Should().Be(0);
        }

        [Fact]
        public async Task Purge_KeepsALockThatIsStillActive()
        {
            await this.LockAsync(EmailCodePurpose.SignUp);

            await this.service.PurgeAsync();

            (await this.db.EmailCodeThrottles.CountAsync()).Should().Be(1);
        }

        [Theory]
        [InlineData("")]
        [InlineData(EmailCodeOptions.PlaceholderKey)]
        [InlineData("too-short")]
        public async Task WithoutAUsableKey_BothCallsAreRefused_AndNothingIsSentOrStored(string key)
        {
            this.settings.HmacKey = key;

            var issue = await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var verify = await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, "123456");

            issue.Status.Should().Be(EmailCodeIssueStatus.Unavailable);
            verify.Status.Should().Be(EmailCodeVerifyStatus.Unavailable);
            this.sender.Messages.Should().BeEmpty();
            (await this.db.EmailCodes.CountAsync()).Should().Be(0);
        }

        [Fact]
        public async Task ADifferentKeyCannotVerifyAStoredCode()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var code = this.sender.LastCode;
            this.settings.HmacKey = "another-key-another-key-another-key-0123";

            (await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, code)).Status
                .Should().Be(EmailCodeVerifyStatus.Invalid);
        }

        [Fact]
        public async Task Verify_WithNoOpenCode_StoresNoThrottleRow()
        {
            var never = await this.service.VerifyAsync("nobody@example.com", EmailCodePurpose.SignUp, "123456");

            never.Status.Should().Be(EmailCodeVerifyStatus.Invalid);

            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            var code = this.sender.LastCode;
            this.clock.Advance(TimeSpan.FromMinutes(11));
            (await this.service.VerifyAsync(Email, EmailCodePurpose.SignUp, code)).Status
                .Should().Be(EmailCodeVerifyStatus.Invalid);
            (await this.db.EmailCodeThrottles.CountAsync()).Should().Be(0);
        }

        [Fact]
        public async Task AnAddressLongerThanTheLimit_IsRefusedWithoutStoringAnything()
        {
            var longEmail = new string('a', EmailCodeService.MaxEmailLength) + "@example.com";

            (await this.service.VerifyAsync(longEmail, EmailCodePurpose.SignUp, "123456")).Status
                .Should().Be(EmailCodeVerifyStatus.Invalid);
            var issue = () => this.service.IssueAsync(longEmail, EmailCodePurpose.SignUp);

            await issue.Should().ThrowAsync<ArgumentOutOfRangeException>();
            (await this.db.EmailCodes.CountAsync()).Should().Be(0);
        }

        [Fact]
        public async Task TheVersionColumnIsAConcurrencyToken_SoALateWriterFails()
        {
            await this.service.IssueAsync(Email, EmailCodePurpose.SignUp);
            await using var other = new AccountDbContext(new DbContextOptionsBuilder<AccountDbContext>()
                .UseInMemoryDatabase(this.dbName)
                .Options);
            var mine = await this.db.EmailCodes.SingleAsync();
            var theirs = await other.EmailCodes.SingleAsync();

            mine.Version++;
            await this.db.SaveChangesAsync();
            theirs.Version++;
            var late = () => other.SaveChangesAsync();

            await late.Should().ThrowAsync<DbUpdateConcurrencyException>();
        }

        [Fact]
        public void Options_AKeyThatIsMissingShortOrThePlaceholder_DoesNotFailValidation_ButIsNotConfigured()
        {
            foreach (var key in new[] { string.Empty, "short", EmailCodeOptions.PlaceholderKey })
            {
                var options = new EmailCodeOptions { HmacKey = key };

                options.Validate().Should().BeNull();
                options.IsConfigured.Should().BeFalse();
            }
        }

        [Fact]
        public void Options_DefaultsMatchTheEpic_AndValidate()
        {
            var defaults = new EmailCodeOptions();

            defaults.CodeLength.Should().Be(6);
            defaults.Lifetime.Should().Be(TimeSpan.FromMinutes(10));
            defaults.MaxWrongTries.Should().Be(5);
            defaults.LockDuration.Should().Be(TimeSpan.FromMinutes(15));
            defaults.ResendCooldown.Should().Be(TimeSpan.FromSeconds(60));
            defaults.MaxPerHour.Should().Be(5);
            defaults.MaxPerDay.Should().Be(10);
            defaults.Validate().Should().BeNull();
            defaults.IsConfigured.Should().BeFalse();
        }

        [Fact]
        public void Options_RefuseABadValue()
        {
            new EmailCodeOptions { CodeLength = 5 }.Validate().Should().Contain("CodeLength");
            new EmailCodeOptions { Lifetime = TimeSpan.FromMinutes(11) }.Validate().Should().Contain("Lifetime");
            new EmailCodeOptions { Lifetime = TimeSpan.Zero }.Validate().Should().Contain("Lifetime");
            new EmailCodeOptions { MaxWrongTries = 0 }.Validate().Should().Contain("MaxWrongTries");
            new EmailCodeOptions { LockDuration = TimeSpan.Zero }.Validate().Should().Contain("LockDuration");
            new EmailCodeOptions { FailureWindow = TimeSpan.FromMinutes(1) }.Validate().Should().Contain("FailureWindow");
            new EmailCodeOptions { ResendCooldown = TimeSpan.FromSeconds(-1) }.Validate().Should().Contain("ResendCooldown");
            new EmailCodeOptions { MaxPerHour = 0 }.Validate().Should().Contain("MaxPerHour");
            new EmailCodeOptions { MaxPerHour = 6, MaxPerDay = 5 }.Validate().Should().Contain("MaxPerDay");
            new EmailCodeOptions { PurgeInterval = TimeSpan.Zero }.Validate().Should().Contain("PurgeInterval");
        }

        private static string Wrong(string code) => code == "000000" ? "000001" : "000000";

        private EmailCodeService NewService() =>
            new(
                this.db,
                Options.Create(this.settings),
                new IdentityEmailComposer(
                    Options.Create(new TransactionalEmailOptions
                    {
                        FromName = "Cribstop (Real Broker, LLC)",
                        FromAddress = "no-reply@cribstop.com",
                        ReplyToAddress = "contact@cribstop.com",
                        BrokerageDisclosure = "Cribstop is brokered by Real Broker, LLC.",
                    })),
                this.sender,
                this.clock,
                NullLogger<EmailCodeService>.Instance);

        private async Task LockAsync(EmailCodePurpose purpose)
        {
            await this.service.IssueAsync(Email, purpose);
            var wrong = Wrong(this.sender.LastCode);
            for (var i = 0; i < 5; i++)
            {
                await this.service.VerifyAsync(Email, purpose, wrong);
            }
        }

        private sealed class Sender : IOutboundEmailSender
        {
            internal List<OutboundEmail> Messages { get; } = new();

            internal string LastCode => this.Messages[^1].Subject.Split(' ')[0];

            public Task SendAsync(OutboundEmail message, CancellationToken cancellationToken = default)
            {
                this.Messages.Add(message);
                return Task.CompletedTask;
            }
        }
    }
}
