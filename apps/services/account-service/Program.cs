// <copyright file="Program.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net.Sockets;
using AccountService.Data;
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
        builder.Services.AddDbContext<AccountDbContext>(options => options.UseNpgsql(connectionString));
        builder.Services.AddAuthorization();
        builder.Services
            .AddIdentityApiEndpoints<IdentityUser>()
            .AddEntityFrameworkStores<AccountDbContext>();

        var app = builder.Build();

        app.MapOpenApi();

        app.UseAuthentication();
        app.UseAuthorization();

        app.MapGroup("/account").MapIdentityApi<IdentityUser>();

        app.MapGet("/account/health", () => Results.Ok(new { status = "healthy" }));
        app.MapGet("/account/health/ready", () => Results.Ok(new { status = "ready" }));

        await app.RunAsync().ConfigureAwait(false);
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

        var fallbackHost = configuration["ACCOUNT_DB_HOST"] ?? "postgres-svc";
        var fallbackPort = configuration["ACCOUNT_DB_PORT"] ?? "5432";
        var fallbackDatabase = configuration["ACCOUNT_DB_NAME"] ?? "account_db";
        var fallbackUsername = configuration["ACCOUNT_DB_USER"] ?? "account_service_db_user";
        var fallbackPassword = configuration["ACCOUNT_SERVICE_DB_USER_PASSWORD"] ?? "StrongBase64Password";

        return $"Host={fallbackHost};Port={fallbackPort};Database={fallbackDatabase};Username={fallbackUsername};Password={fallbackPassword}";
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
