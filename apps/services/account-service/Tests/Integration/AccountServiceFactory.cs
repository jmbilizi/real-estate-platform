// <copyright file="AccountServiceFactory.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Data;
using AccountService.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Shared <see cref="WebApplicationFactory{TEntryPoint}"/> that replaces the Postgres
    /// database with an in-memory EF Core provider so integration tests run without a live DB.
    /// </summary>
    public class AccountServiceFactory : WebApplicationFactory<TestEntryPoint>
    {
        /// <summary>The web origin every test host is configured with.</summary>
        internal const string WebOrigin = "https://web.test.example";

        /// <summary>The confirmation path every test host is configured with.</summary>
        internal const string ConfirmationPath = "/confirm-email";

        private readonly string dbName = $"AccountServiceTest-{Guid.NewGuid()}";

        /// <summary>Gets every log entry the host wrote.</summary>
        internal CapturingLoggerProvider Logs { get; } = new();

        /// <inheritdoc/>
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);
            builder.UseEnvironment("Testing");
            builder.ConfigureLogging(logging => logging.AddProvider(this.Logs));

            builder.ConfigureServices(services =>
            {
                // Remove the Npgsql DbContext registration added by Program.cs
                var descriptor = services.SingleOrDefault(
                    d => d.ServiceType == typeof(DbContextOptions<AccountDbContext>));
                if (descriptor is not null)
                {
                    services.Remove(descriptor);
                }

                // Re-register with the same in-memory DB name used by CreateHost seeding
                services.AddDbContext<AccountDbContext>(options =>
                    options.UseInMemoryDatabase(this.dbName));

                // TestServer requests carry no remote address, so every caller in a shared host
                // shares one "unknown" bucket. Lift the limits and the timing floor out of the way.
                // AccountRecoveryFactory sets back whatever its own tests need.
                services.Configure<AccountRecoveryOptions>(options =>
                {
                    options.WebBaseUrl = new Uri(WebOrigin);
                    options.ConfirmationPath = ConfirmationPath;
                    options.ResendMinimumInterval = TimeSpan.Zero;
                    options.ResendsPerEmailPerHour = int.MaxValue;
                    options.ResendsPerEmailPerDay = int.MaxValue;
                    options.ResendsPerAddress = int.MaxValue;
                    options.RequestsPerEmail = int.MaxValue;
                    options.RequestsPerAddress = int.MaxValue;
                    options.RedemptionsPerAddress = int.MaxValue;
                    options.RegistrationsPerAddress = int.MaxValue;
                    options.MinimumResponseDuration = TimeSpan.Zero;
                });
            });
        }

        /// <inheritdoc/>
        protected override IHost CreateHost(IHostBuilder builder)
        {
            var host = base.CreateHost(builder);

            // Seed roles via the host's actual DI container so they are visible
            // to the same in-memory DB that the app uses during tests.
            using var scope = host.Services.CreateScope();
            var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
            string[] roles =
            [
                Roles.SuperAdmin, Roles.Admin, Roles.Moderator,
                Roles.Support, Roles.Developer, Roles.User,
            ];
            foreach (var role in roles)
            {
                if (!roleManager.RoleExistsAsync(role).GetAwaiter().GetResult())
                {
                    roleManager.CreateAsync(new IdentityRole(role)).GetAwaiter().GetResult();
                }
            }

            return host;
        }
    }
}
