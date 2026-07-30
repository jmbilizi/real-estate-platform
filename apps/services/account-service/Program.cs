// <copyright file="Program.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net.Sockets;
using AccountService.Configuration;
using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
using AccountService.Routes;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace AccountService;

internal static class Program
{
    public static async Task Main(string[] args)
    {
        // K8s init container mode: run migrations and exit.
        // The deployment's initContainer passes --migrate-only so migrations
        // complete before the main container starts.
        if (args.Contains("--migrate-only"))
        {
            try
            {
                await RunMigrationsAsync().ConfigureAwait(false);
                return;
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"FATAL: Migration failed after all retries: {ex}").ConfigureAwait(false);
                throw;
            }
        }

        var builder = WebApplication.CreateBuilder(args);

        var connectionString = ResolveConnectionString(builder.Configuration);

        builder.Services.AddOpenApi();
        builder.Services.AddHttpContextAccessor();
        builder.Services.Configure<AppSettings>(builder.Configuration.GetSection(AppSettings.SectionName));
        builder.Services.AddDbContext<AccountDbContext>(options => options.UseNpgsql(connectionString));
        builder.Services.AddScoped<IClaimsTransformation, UserAppClaimsTransformation>();

        builder.Services
            .AddAuthentication(IdentityConstants.ApplicationScheme)
            .AddScheme<AuthenticationSchemeOptions, ApiKeyAuthenticationHandler>(
                ApiKeyDefaults.AuthenticationScheme, null);

        builder.Services.AddAuthorization(options =>
        {
            options.DefaultPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder(
                IdentityConstants.ApplicationScheme,
                IdentityConstants.BearerScheme,
                ApiKeyDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser()
                .Build();
        });

        builder.Services
            .AddIdentityApiEndpoints<ApplicationUser>()
            .AddRoles<IdentityRole>()
            .AddUserManager<AppUserManager>()
            .AddSignInManager<AppSignInManager>()
            .AddEntityFrameworkStores<AccountDbContext>();

        // Revoke existing sessions immediately when the security stamp changes
        // (e.g., on account soft-delete or admin suspension).
        // ValidationInterval = Zero re-checks the stamp against the DB on every authenticated request.
        builder.Services.Configure<SecurityStampValidatorOptions>(options =>
            options.ValidationInterval = TimeSpan.Zero);

        var app = builder.Build();

        // Seed platform roles after the app starts listening so the readiness probe
        // is not blocked by a slow DB connection on startup.
        // Skipped in the "Testing" environment: AccountServiceFactory already seeds
        // roles synchronously against the same in-memory DB before requests are
        // dispatched. Running both concurrently races on the EF InMemory provider
        // (which does not enforce unique constraints) and can create duplicate
        // IdentityRole rows, breaking single-role lookups like IsInRoleAsync.
        if (!app.Environment.IsEnvironment("Testing"))
        {
            app.Lifetime.ApplicationStarted.Register(() =>
                _ = SeedRolesAsync(app.Services));
        }

        app.MapOpenApi();

        app.UseAuthentication();
        app.UseAuthorization();

        // Infrastructure: liveness/startup probe for K8s — mapped first so it is always reachable
        app.MapGet("/account/health", () => Results.Ok(new { status = "healthy" }));

        // Readiness probe — same response; kept separate so K8s can distinguish liveness from readiness
        app.MapGet("/account/health/ready", () => Results.Ok(new { status = "ready" }));

        // Identity: built-in ASP.NET Identity endpoints (register, login, refresh, etc.)
        app.MapGroup("/account").MapIdentityApi<ApplicationUser>();

        // Profile: GET/PUT/DELETE /account/profile, GET /account/{userId}/history
        app.MapProfileRoutes();

        // Admin: GET/POST/DELETE /account/{userId}/roles
        app.MapAdminRoutes();

        // API Keys: POST/GET/DELETE /account/api-keys
        app.MapApiKeyRoutes();

        await app.RunAsync().ConfigureAwait(false);
    }

    private static async Task SeedRolesAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();

        string[] roles =
        [
            Roles.SuperAdmin,
            Roles.Admin,
            Roles.Moderator,
            Roles.Support,
            Roles.Developer,
            Roles.User,
        ];

        foreach (var role in roles)
        {
            if (!await roleManager.RoleExistsAsync(role).ConfigureAwait(false))
            {
                await roleManager.CreateAsync(new IdentityRole(role)).ConfigureAwait(false);
            }
        }
    }

    private static async Task RunMigrationsAsync()
    {
        var configuration = new ConfigurationBuilder()
            .AddEnvironmentVariables()
            .Build();

        var connectionString = ResolveConnectionString(configuration);
        var options = new DbContextOptionsBuilder<AccountDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        using var dbContext = new AccountDbContext(options);
        await MigrateWithRetryAsync(dbContext).ConfigureAwait(false);

        await Console.Out.WriteLineAsync("Migrations completed successfully.").ConfigureAwait(false);
    }

    private static async Task MigrateWithRetryAsync(AccountDbContext dbContext)
    {
        var delay = TimeSpan.FromSeconds(2);
        const int maxAttempts = 12;

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                await dbContext.Database.MigrateAsync().ConfigureAwait(false);
                return;
            }
            catch (Exception exception) when (IsTransientDatabaseStartupFailure(exception) && attempt < maxAttempts)
            {
                await Console.Error.WriteLineAsync(
                    $"Database not ready. Retrying {attempt}/{maxAttempts} in {delay.TotalSeconds}s. {exception.Message}")
                    .ConfigureAwait(false);

                await Task.Delay(delay).ConfigureAwait(false);
                delay = TimeSpan.FromSeconds(Math.Min(delay.TotalSeconds * 2, 10));
            }
        }

        await dbContext.Database.MigrateAsync().ConfigureAwait(false);
    }

    private static string ResolveConnectionString(IConfiguration configuration)
    {
        var hasEnvironmentDatabaseConfiguration =
            !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ACCOUNT_DB_HOST")) ||
            !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ACCOUNT_DB_PORT")) ||
            !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ACCOUNT_DB_NAME")) ||
            !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ACCOUNT_DB_USER")) ||
            !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ACCOUNT_SERVICE_DB_USER_PASSWORD"));

        if (hasEnvironmentDatabaseConfiguration)
        {
            var host = configuration["ACCOUNT_DB_HOST"] ?? "postgres-svc";
            var port = configuration["ACCOUNT_DB_PORT"] ?? "5432";
            var database = configuration["ACCOUNT_DB_NAME"] ?? "account_db";
            var username = configuration["ACCOUNT_DB_USER"] ?? "account_service_db_user";
            var password = configuration["ACCOUNT_SERVICE_DB_USER_PASSWORD"] ?? "StrongBase64Password";

            return $"Host={host};Port={port};Database={database};Username={username};Password={password}";
        }

        var configuredConnectionString = configuration.GetConnectionString("AccountDb");
        if (!string.IsNullOrWhiteSpace(configuredConnectionString))
        {
            return configuredConnectionString;
        }

        // No environment variables and no connection string configured — use hardcoded defaults
        // suitable for local development only.
        return "Host=postgres-svc;Port=5432;Database=account_db;Username=account_service_db_user;Password=StrongBase64Password";
    }

    private static bool IsTransientDatabaseStartupFailure(Exception exception)
    {
        if (exception is not NpgsqlException npgsqlException)
        {
            return false;
        }

        // TCP-level failures: PostgreSQL pod not yet scheduled or not accepting connections.
        if (npgsqlException.InnerException is SocketException or TimeoutException ||
            npgsqlException.Message.Contains("Failed to connect", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (npgsqlException is PostgresException pgEx)
        {
            return pgEx.SqlState switch
            {
                // Database hasn't been created yet by init-databases.sh.
                "3D000" => true,

                // Schema grants not yet applied (race between CREATE DATABASE and GRANT ON SCHEMA
                // in init-databases.sh). Safe to retry during PostgreSQL initialisation.
                "42501" => true,

                // Password mismatch during startup — postStart hook on Postgres may still be
                // running ALTER USER to sync the password from the current secret.
                // Retry with backoff so account-service waits for sync to complete.
                "28P01" => true,

                _ => false,
            };
        }

        return false;
    }
}
