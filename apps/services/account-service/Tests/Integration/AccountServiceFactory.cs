// <copyright file="AccountServiceFactory.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Data;
using AccountService.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Shared <see cref="WebApplicationFactory{TEntryPoint}"/> that replaces the Postgres
    /// database with an in-memory EF Core provider so integration tests run without a live DB.
    /// </summary>
    public class AccountServiceFactory : WebApplicationFactory<TestEntryPoint>
    {
        private readonly string dbName = $"AccountServiceTest-{Guid.NewGuid()}";

        /// <inheritdoc/>
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);
            builder.UseEnvironment("Testing");

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
