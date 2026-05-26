// <copyright file="Program.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace AccountService;

internal static class Program
{
    public static async Task Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        var connectionString = ResolveConnectionString(builder.Configuration);

        builder.Services.AddOpenApi();
        builder.Services.AddDbContext<AccountDbContext>(options => options.UseNpgsql(connectionString));
        builder.Services.AddAuthorization();
        builder.Services
            .AddIdentityApiEndpoints<IdentityUser>()
            .AddEntityFrameworkStores<AccountDbContext>();

        var app = builder.Build();

        await EnsureDatabaseCreatedAsync(app.Services).ConfigureAwait(false);

        app.MapOpenApi();

        app.UseAuthentication();
        app.UseAuthorization();

        app.MapGroup("/account").MapIdentityApi<IdentityUser>();

        app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
        app.MapGet("/health/ready", () => Results.Ok(new { status = "ready" }));

        await app.RunAsync().ConfigureAwait(false);
    }

    private static string ResolveConnectionString(ConfigurationManager configuration)
    {
        var configuredConnectionString = configuration.GetConnectionString("AccountDb");
        if (!string.IsNullOrWhiteSpace(configuredConnectionString))
        {
            return configuredConnectionString;
        }

        var host = configuration["ACCOUNT_DB_HOST"] ?? "postgres-svc";
        var port = configuration["ACCOUNT_DB_PORT"] ?? "5432";
        var database = configuration["ACCOUNT_DB_NAME"] ?? "account_db";
        var username = configuration["ACCOUNT_DB_USER"] ?? "account_service_db_user";
        var password = configuration["ACCOUNT_SERVICE_DB_USER_PASSWORD"] ?? "StrongBase64Password";

        return $"Host={host};Port={port};Database={database};Username={username};Password={password}";
    }

    private static async Task EnsureDatabaseCreatedAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
        await dbContext.Database.EnsureCreatedAsync().ConfigureAwait(false);
    }
}
