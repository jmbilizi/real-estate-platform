// <copyright file="AccountDbContext.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics.CodeAnalysis;
using AccountService.Models;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace AccountService.Data;

[SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by dependency injection.")]
internal class AccountDbContext(DbContextOptions<AccountDbContext> options)
    : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<AccountStatus> AccountStatuses => Set<AccountStatus>();

    public DbSet<Locale> Locales => Set<Locale>();

    public DbSet<ApiKey> ApiKeys => Set<ApiKey>();

    public DbSet<UserApp> UserApps => Set<UserApp>();

    public DbSet<WaitlistInterest> WaitlistInterests => Set<WaitlistInterest>();

    public DbSet<RoleGrantAudit> RoleGrantAudits => Set<RoleGrantAudit>();

    public DbSet<EmailCode> EmailCodes => Set<EmailCode>();

    public DbSet<EmailCodeThrottle> EmailCodeThrottles => Set<EmailCodeThrottle>();

    public DbSet<PendingRegistration> PendingRegistrations => Set<PendingRegistration>();

    /// <summary>Gets the addresses Postmark will not deliver to.</summary>
    public DbSet<EmailSuppression> EmailSuppressions => Set<EmailSuppression>();

    public DbSet<AccountSecurityEvent> AccountSecurityEvents => Set<AccountSecurityEvent>();

    public DbSet<PasswordResetProof> PasswordResetProofs => Set<PasswordResetProof>();

    public DbSet<PendingEmailChange> PendingEmailChanges => Set<PendingEmailChange>();

    public DbSet<EmailChangeRestore> EmailChangeRestores => Set<EmailChangeRestore>();

    public DbSet<SecureAccountToken> SecureAccountTokens => Set<SecureAccountToken>();

    public DbSet<LookingForPreference> LookingForPreferences => Set<LookingForPreference>();

    public DbSet<NotificationPreference> NotificationPreferences => Set<NotificationPreference>();

    public DbSet<NotificationPreferenceAudit> NotificationPreferenceAudits => Set<NotificationPreferenceAudit>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<ApplicationUser>(entity =>
        {
            // String defaults
            entity.Property(u => u.FirstName).HasDefaultValue(string.Empty);
            entity.Property(u => u.LastName).HasDefaultValue(string.Empty);
            entity.Property(u => u.MiddleName).HasDefaultValue(string.Empty);

            // Core identity defaults (VerifiedAt/VerifiedByUserId/VerificationNote are null until set by admin)

            // FK: AccountStatusId → AccountStatus.Id (set null if status row is removed)
            entity.HasOne(u => u.AccountStatus)
                .WithMany()
                .HasForeignKey(u => u.AccountStatusId)
                .OnDelete(DeleteBehavior.SetNull)
                .IsRequired(false);

            // Timestamp defaults (PostgreSQL NOW())
            entity.Property(u => u.CreatedAt)
                .HasDefaultValueSql("NOW()")
                .ValueGeneratedOnAdd();

            // UpdatedAt: default on insert; managed manually in application code on updates
            entity.Property(u => u.UpdatedAt)
                .HasDefaultValueSql("NOW()")
                .ValueGeneratedOnAdd();

            // Check constraint — DateOfBirth must be a plausible past date (not more than 150 years ago, not in the future)
            entity.ToTable(t =>
            {
                t.HasCheckConstraint(
                    "CK_AspNetUsers_DateOfBirth",
                    "\"DateOfBirth\" >= (CURRENT_DATE - INTERVAL '150 years') AND \"DateOfBirth\" <= CURRENT_DATE");
            });

            // Self-referential FK: VerifiedByUserId → AspNetUsers.Id
            entity.HasOne(u => u.VerifiedByUser)
                .WithMany()
                .HasForeignKey(u => u.VerifiedByUserId)
                .OnDelete(DeleteBehavior.Restrict)
                .IsRequired(false);

            // Self-referential FK: CreatedByUserId → AspNetUsers.Id
            entity.HasOne(u => u.CreatedByUser)
                .WithMany()
                .HasForeignKey(u => u.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict)
                .IsRequired(false);

            // Self-referential FK: UpdatedByUserId → AspNetUsers.Id
            entity.HasOne(u => u.UpdatedByUser)
                .WithMany()
                .HasForeignKey(u => u.UpdatedByUserId)
                .OnDelete(DeleteBehavior.Restrict)
                .IsRequired(false);

            // Self-referential FK: DeletedByUserId → AspNetUsers.Id
            entity.HasOne(u => u.DeletedByUser)
                .WithMany()
                .HasForeignKey(u => u.DeletedByUserId)
                .OnDelete(DeleteBehavior.Restrict)
                .IsRequired(false);

            // FK: PreferredLocaleId → Locale.Id (set null if locale is removed)
            entity.HasOne(u => u.PreferredLocale)
                .WithMany()
                .HasForeignKey(u => u.PreferredLocaleId)
                .OnDelete(DeleteBehavior.SetNull)
                .IsRequired(false);

            // Notification channel toggles — stored directly on the user row
            entity.Property(u => u.EmailNotificationsEnabled).HasDefaultValue(false);
            entity.Property(u => u.SmsNotificationsEnabled).HasDefaultValue(false);
            entity.Property(u => u.PushNotificationsEnabled).HasDefaultValue(true);
            entity.Property(u => u.MarketingOptIn).HasDefaultValue(false);

            // Onboarding intents (PRD §4.4) — Npgsql maps List<string> to a native text[] column.
            // Fixed vocabulary (see OnboardingIntents) is validated at the API boundary, not via a
            // DB CHECK constraint, to keep the migration simple.
            entity.Property(u => u.Intents)
                .HasColumnType("text[]")
                .HasDefaultValueSql("ARRAY[]::text[]");
        });

        builder.Entity<AccountStatus>(entity =>
        {
            entity.ToTable("AccountStatuses");
            entity.Property(a => a.Code).IsRequired().HasDefaultValue(string.Empty);
            entity.Property(a => a.Label).IsRequired().HasDefaultValue(string.Empty);
            entity.HasIndex(a => a.Code).IsUnique();
        });

        builder.Entity<Locale>(entity =>
        {
            entity.ToTable("Locales");
            entity.Property(l => l.Code).IsRequired().HasDefaultValue(string.Empty);
            entity.Property(l => l.Name).IsRequired().HasDefaultValue(string.Empty);
            entity.HasIndex(l => l.Code).IsUnique();
        });

        builder.Entity<ApiKey>(entity =>
        {
            entity.ToTable("ApiKeys");
            entity.Property(k => k.Name).IsRequired().HasDefaultValue(string.Empty);
            entity.Property(k => k.Prefix).IsRequired().HasDefaultValue(string.Empty);
            entity.Property(k => k.KeyHash).IsRequired().HasDefaultValue(string.Empty);

            entity.Property(k => k.CreatedAt)
                .HasDefaultValueSql("NOW()")
                .ValueGeneratedOnAdd();

            entity.HasOne(k => k.User)
                .WithMany(u => u.ApiKeys)
                .HasForeignKey(k => k.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .IsRequired();

            entity.HasIndex(k => k.UserId);
            entity.HasIndex(k => k.KeyHash).IsUnique();
            entity.HasIndex(k => k.Prefix);
        });

        builder.Entity<UserApp>(entity =>
        {
            entity.ToTable("UserApps");
            entity.HasKey(ua => new { ua.UserId, ua.AppId });

            entity.Property(ua => ua.FirstSeenAt)
                .HasDefaultValueSql("NOW()")
                .ValueGeneratedOnAdd();

            entity.Property(ua => ua.LastSeenAt)
                .HasDefaultValueSql("NOW()")
                .ValueGeneratedOnAdd();

            entity.HasOne(ua => ua.User)
                .WithMany(u => u.UserApps)
                .HasForeignKey(ua => ua.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .IsRequired();

            entity.HasIndex(ua => ua.UserId);
        });

        builder.Entity<WaitlistInterest>(entity =>
        {
            entity.ToTable("WaitlistInterests");

            // Composite key gives idempotent registration at the storage layer: a second insert for
            // the same pair cannot create a second row.
            entity.HasKey(wi => new { wi.UserId, wi.InterestKind });

            entity.Property(wi => wi.RegisteredAt)
                .HasDefaultValueSql("NOW()")
                .ValueGeneratedOnAdd();

            entity.HasOne(wi => wi.User)
                .WithMany(u => u.WaitlistInterests)
                .HasForeignKey(wi => wi.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .IsRequired();

            // No separate UserId index. The composite key leads with UserId, so it already serves
            // the only query shape here ("this account's interests"). UserApps above does carry
            // one; it is redundant there too, and is not copied forward.

            // Fixed vocabulary (see WaitlistInterestKinds) is validated at the API boundary, not
            // with a DB CHECK constraint — same approach as the onboarding intents above.
        });

        // No FK to AspNetUsers, like SecureAccountTokens. The key leads with UserId, so it serves the
        // only query shape: "this account's preferences". New table, so no CONCURRENTLY is needed.
        builder.Entity<LookingForPreference>(entity =>
        {
            entity.ToTable("LookingForPreferences");
            entity.HasKey(p => new { p.UserId, p.Id });
            entity.Property(p => p.Intent).IsRequired();
            entity.Property(p => p.PlacesJson).HasColumnType("jsonb").IsRequired();
            entity.Property(p => p.HomeTypes).HasColumnType("text[]").IsRequired();
        });

        // No FK to AspNetUsers, so the consent record outlives the account. The key leads with AccountId.
        // A missing row means "not opted in". Times are set in code, so the in-memory tests need no SQL default.
        builder.Entity<NotificationPreference>(entity =>
        {
            entity.ToTable("NotificationPreferences");
            entity.HasKey(p => new { p.AccountId, p.Channel, p.Category });
            entity.Property(p => p.Source).IsRequired();
        });

        // Append-only. No FK to AspNetUsers. Holds no email address.
        builder.Entity<NotificationPreferenceAudit>(entity =>
        {
            entity.ToTable("NotificationPreferenceAudits");
            entity.Property(a => a.AccountId).IsRequired();
            entity.Property(a => a.Channel).IsRequired();
            entity.Property(a => a.Category).IsRequired();
            entity.Property(a => a.Source).IsRequired();
            entity.HasIndex(a => new { a.AccountId, a.OccurredAt });
        });

        // Append-only. No FK to AspNetUsers, so the record outlives a deleted grantor or grantee.
        builder.Entity<RoleGrantAudit>(entity =>
        {
            entity.ToTable("RoleGrantAudits");
            entity.Property(a => a.GrantorUserId).IsRequired();
            entity.Property(a => a.GranteeUserId).IsRequired();
            entity.Property(a => a.Role).IsRequired();
            entity.Property(a => a.Action).IsRequired();
            entity.Property(a => a.OccurredAt).HasDefaultValueSql("NOW()").ValueGeneratedOnAdd();
            entity.HasIndex(a => a.GranteeUserId);
        });

        // No FK to AspNetUsers: a code can target an address with no account. The hash is a keyed
        // HMAC; the key never reaches the database.
        builder.Entity<EmailCode>(entity =>
        {
            entity.ToTable("EmailCodes");
            entity.Property(c => c.Email).IsRequired();
            entity.Property(c => c.Purpose).HasConversion<string>().IsRequired();
            entity.Property(c => c.CodeHash).IsRequired();
            entity.HasIndex(c => new { c.Email, c.Purpose, c.CreatedAt });
            entity.Property(c => c.Version).IsConcurrencyToken();
            entity.HasIndex(c => c.ExpiresAt);
        });

        builder.Entity<EmailCodeThrottle>(entity =>
        {
            entity.ToTable("EmailCodeThrottles");
            entity.HasKey(t => new { t.Email, t.Purpose });
            entity.Property(t => t.Purpose).HasConversion<string>();
            entity.Property(t => t.Version).IsConcurrencyToken();
            entity.HasIndex(t => t.UpdatedAt);
        });

        // No FK to AspNetUsers and no password: a pending sign-up is not an account.
        builder.Entity<PendingRegistration>(entity =>
        {
            entity.ToTable("PendingRegistrations");
            entity.Property(p => p.Email).IsRequired();
            entity.Property(p => p.EmailAsEntered).IsRequired();
            entity.Property(p => p.State).HasConversion<string>().IsRequired();
            entity.HasIndex(p => p.Email).IsUnique();
            entity.HasIndex(p => p.ExpiresAt);
            entity.Property(p => p.Version).IsConcurrencyToken();
        });

        // No FK to AspNetUsers: a sign-up has no account. One row per normalized address.
        builder.Entity<EmailSuppression>(entity =>
        {
            entity.ToTable("EmailSuppressions");
            entity.Property(s => s.Email).IsRequired();
            entity.Property(s => s.Reason).IsRequired();
            entity.Property(s => s.Source).IsRequired();
            entity.HasIndex(s => s.Email).IsUnique();
        });

        // Append-only. No FK to AspNetUsers, so the record outlives a deleted account.
        builder.Entity<AccountSecurityEvent>(entity =>
        {
            entity.ToTable("AccountSecurityEvents");
            entity.Property(e => e.UserId).IsRequired();
            entity.Property(e => e.Kind).IsRequired();
            entity.Property(e => e.OccurredAt).HasDefaultValueSql("NOW()").ValueGeneratedOnAdd();
            entity.HasIndex(e => new { e.UserId, e.OccurredAt });
        });

        // No FK to AspNetUsers. The row holds a hash of the proof, never the proof.
        builder.Entity<PasswordResetProof>(entity =>
        {
            entity.ToTable("PasswordResetProofs");
            entity.Property(p => p.Email).IsRequired();
            entity.Property(p => p.UserId).IsRequired();
            entity.Property(p => p.ProofHash).IsRequired();
            entity.HasIndex(p => p.Email).IsUnique();
            entity.HasIndex(p => p.ExpiresAt);
            entity.Property(p => p.Version).IsConcurrencyToken();
        });

        // No FK to AspNetUsers. One pending change per account.
        builder.Entity<PendingEmailChange>(entity =>
        {
            entity.ToTable("PendingEmailChanges");
            entity.Property(p => p.UserId).IsRequired();
            entity.Property(p => p.NewEmail).IsRequired();
            entity.HasIndex(p => p.UserId).IsUnique();
            entity.HasIndex(p => p.ExpiresAt);
            entity.Property(p => p.Version).IsConcurrencyToken();
        });

        // No FK to AspNetUsers, so the row outlives a deleted account until the purge.
        builder.Entity<EmailChangeRestore>(entity =>
        {
            entity.ToTable("EmailChangeRestores");
            entity.Property(r => r.UserId).IsRequired();
            entity.Property(r => r.OldEmail).IsRequired();
            entity.HasIndex(r => new { r.UserId, r.RestoreUntil });
        });

        // No FK to AspNetUsers. Only the token hash is stored.
        builder.Entity<SecureAccountToken>(entity =>
        {
            entity.ToTable("SecureAccountTokens");
            entity.Property(t => t.UserId).IsRequired();
            entity.Property(t => t.Kind).IsRequired();
            entity.Property(t => t.TokenHash).IsRequired();
            entity.Property(t => t.Version).IsConcurrencyToken();
            entity.HasIndex(t => t.TokenHash).IsUnique();
            entity.HasIndex(t => t.ExpiresAt);
            entity.HasIndex(t => t.UserId);
        });
    }
}
