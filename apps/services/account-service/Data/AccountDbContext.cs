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
            entity.Property(u => u.EmailNotificationsEnabled).HasDefaultValue(true);
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
    }
}
