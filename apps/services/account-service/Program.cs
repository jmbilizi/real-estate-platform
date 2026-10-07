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
using Microsoft.AspNetCore.Authentication.BearerToken;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AccountService;

internal static class Program
{
    /// <summary>The event id of the startup warning while the email code engine has no key.</summary>
    internal static readonly EventId EmailCodesNotConfiguredEvent = new(1384, "EmailCodesNotConfigured");

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
        builder.Services.TryAddSingleton(TimeProvider.System);
        builder.Services.Configure<AppSettings>(builder.Configuration.GetSection(AppSettings.SectionName));
        builder.Services
            .AddOptions<AccountRecoveryOptions>()
            .Bind(builder.Configuration.GetSection(AccountRecoveryOptions.SectionName))
            .Validate(options => options.Validate() is null, "AccountRecovery configuration is invalid. See AccountRecoveryOptions.Validate.")
            .ValidateOnStart();
        builder.Services
            .AddOptions<TransactionalEmailOptions>()
            .Bind(builder.Configuration.GetSection(TransactionalEmailOptions.SectionName))
            .Validate(options => options.Validate() is null, "Email configuration is invalid. See TransactionalEmailOptions.Validate.")
            .ValidateOnStart();
        builder.Services
            .AddOptions<PostmarkOptions>()
            .Bind(builder.Configuration.GetSection(PostmarkOptions.SectionName))

            // POSTMARK_SERVER_TOKEN is a flat secret env var (infra/k8s/base/secrets/postmark.secret.yaml),
            // not nested under the Postmark section like the rest of these options.
            .PostConfigure(options =>
            {
                var token = builder.Configuration["POSTMARK_SERVER_TOKEN"];
                if (!string.IsNullOrWhiteSpace(token))
                {
                    options.ServerToken = token;
                }

                // Flat env vars too. The webhook stays closed until both are set (#664).
                var webhookUser = builder.Configuration["POSTMARK_WEBHOOK_USER"];
                if (!string.IsNullOrWhiteSpace(webhookUser))
                {
                    options.WebhookUser = webhookUser;
                }

                var webhookPassword = builder.Configuration["POSTMARK_WEBHOOK_PASSWORD"];
                if (!string.IsNullOrWhiteSpace(webhookPassword))
                {
                    options.WebhookPassword = webhookPassword;
                }
            })
            .Validate(options => options.Validate() is null, "Postmark configuration is invalid. See PostmarkOptions.Validate.")
            .ValidateOnStart();
        builder.Services
            .AddOptions<EmailCodeOptions>()
            .Bind(builder.Configuration.GetSection(EmailCodeOptions.SectionName))
            .PostConfigure(options =>
            {
                // Overwrites whatever the section bound: the key comes only from the environment.
                // Any other environment with no key leaves the engine unconfigured, and it refuses every call.
                var key = builder.Configuration[EmailCodeOptions.KeyVariable];
                options.HmacKey = !string.IsNullOrWhiteSpace(key) ? key
                    : builder.Environment.IsDevelopment() || builder.Environment.IsEnvironment("Testing") ? EmailCodeOptions.DevelopmentKey
                    : string.Empty;
            })
            .Validate(options => options.Validate() is null, "EmailCodes configuration is invalid. See EmailCodeOptions.Validate.")
            .ValidateOnStart();
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
            .AddIdentityApiEndpoints<ApplicationUser>(options =>
            {
                options.Tokens.PasswordResetTokenProvider = PasswordResetTokenProvider.ProviderName;
            })
            .AddRoles<IdentityRole>()
            .AddUserManager<AppUserManager>()
            .AddSignInManager<AppSignInManager>()
            .AddEntityFrameworkStores<AccountDbContext>()
            .AddTokenProvider<PasswordResetTokenProvider>(PasswordResetTokenProvider.ProviderName);

        // Password reset runs on its own token provider so its lifetime and its data-protection
        // purpose are independent of every other Identity token. Bound from options, so a test
        // override of AccountRecoveryOptions is the value the provider enforces.
        builder.Services
            .AddOptions<PasswordResetTokenProviderOptions>()
            .Configure<IOptions<AccountRecoveryOptions>>((tokenOptions, recovery) =>
            {
                tokenOptions.Name = PasswordResetTokenProvider.ProviderName;
                tokenOptions.TokenLifespan = recovery.Value.TokenLifetime;
            });

        // Password policy: length and the breached-password check, no composition rules (#654).
        // Identity's stock PasswordValidator is removed. PasswordPolicyValidator is the only
        // validator, so register, change, reset and sign-up all follow it. The Identity switches
        // are cleared too, as a second line should a stock validator return.
        builder.Services
            .AddOptions<PasswordPolicyOptions>()
            .Bind(builder.Configuration.GetSection(PasswordPolicyOptions.SectionName))
            .Validate(options => options.Validate() is null, "PasswordPolicy configuration is invalid. See PasswordPolicyOptions.Validate.")
            .ValidateOnStart();
        builder.Services
            .AddOptions<IdentityOptions>()
            .Configure<IOptions<PasswordPolicyOptions>>((identity, policy) =>
            {
                identity.Password.RequireDigit = false;
                identity.Password.RequireLowercase = false;
                identity.Password.RequireUppercase = false;
                identity.Password.RequireNonAlphanumeric = false;
                identity.Password.RequiredLength = policy.Value.MinLength;
                identity.Password.RequiredUniqueChars = 1;
            });
        builder.Services.RemoveAll<IPasswordValidator<ApplicationUser>>();
        builder.Services.AddScoped<IPasswordValidator<ApplicationUser>, PasswordPolicyValidator>();

        // RemoveAllLoggers: the framework's handler logs the request URI, which holds the SHA-1 prefix.
        builder.Services
            .AddHttpClient<IPwnedPasswordsClient, PwnedPasswordsClient>(
                (sp, http) =>
                {
                    var policy = sp.GetRequiredService<IOptions<PasswordPolicyOptions>>().Value;
                    http.BaseAddress = policy.BreachCheckBaseUrl;
                    http.Timeout = policy.BreachCheckTimeout + TimeSpan.FromSeconds(1);
                })
            .RemoveAllLoggers();
        builder.Services.AddScoped<SignUpCompletion>();

        builder.Services.AddSingleton<AccountRecoveryRateLimiter>();
        builder.Services.AddSingleton<PasswordResetLinkBuilder>();
        builder.Services.AddSingleton<IdentityEmailComposer>();
        builder.Services.AddScoped<EmailCodeService>();
        builder.Services.AddHostedService<EmailCodePurgeService>();
        builder.Services
            .AddOptions<SignUpOptions>()
            .Bind(builder.Configuration.GetSection(SignUpOptions.SectionName))
            .Validate(options => options.Validate() is null, "SignUp configuration is invalid. See SignUpOptions.Validate.")
            .ValidateOnStart();
        builder.Services
            .AddOptions<EmailDeliverabilityOptions>()
            .Bind(builder.Configuration.GetSection(EmailDeliverabilityOptions.SectionName))
            .Validate(options => options.Validate() is null, "EmailDeliverability configuration is invalid. See EmailDeliverabilityOptions.Validate.")
            .ValidateOnStart();
        builder.Services.AddSingleton<IMailDomainResolver, DnsMailDomainResolver>();
        builder.Services.AddScoped<EmailSuppressionService>();
        builder.Services.AddScoped<SignUpService>();
        builder.Services.AddScoped<IdentifyService>();
        builder.Services.AddScoped<PasswordResetService>();
        builder.Services.AddScoped<EmailChangeService>();
        builder.Services.AddScoped<SecurityNoticeService>();
        builder.Services.AddScoped<PasswordChangeService>();
        builder.Services.AddHostedService<PendingRegistrationPurgeService>();

        // The Postmark transport: one background queue, resolved both as the delivery seam
        // (IOutboundEmailSender) and as the hosted service that drains it. Enqueuing never blocks
        // on the network, so no Identity handler's response time depends on the provider.
        builder.Services.AddHttpClient<PostmarkClient>(
            (sp, http) => http.BaseAddress = sp.GetRequiredService<IOptions<PostmarkOptions>>().Value.ApiBaseUrl);

        // A Func<PostmarkClient>, not a captured instance: PostmarkDeliveryQueue is a singleton
        // with a lifetime measured in days, and capturing one PostmarkClient for that whole
        // lifetime would pin its HttpClient handler and defeat IHttpClientFactory's handler
        // rotation (#138 code review).
        builder.Services.AddSingleton(sp =>
            new PostmarkDeliveryQueue(
                sp.GetRequiredService<PostmarkClient>,
                sp.GetRequiredService<IOptions<PostmarkOptions>>(),
                sp.GetRequiredService<ILogger<PostmarkDeliveryQueue>>(),
                sp.GetRequiredService<TimeProvider>(),
                onRecipientInactive: (address, ct) => RecordInactiveRecipientAsync(sp, address, ct)));
        builder.Services.AddSingleton<IOutboundEmailSender>(sp => sp.GetRequiredService<PostmarkDeliveryQueue>());
        builder.Services.AddHostedService(sp => sp.GetRequiredService<PostmarkDeliveryQueue>());

        // The one delivery seam Identity calls into. Without this closed-generic registration
        // Identity's own TryAdd chain (DefaultMessageEmailSender -> NoOpEmailSender) discards every
        // message silently.
        builder.Services.AddTransient<IEmailSender<ApplicationUser>, PostmarkEmailSender>();

        // Revoke existing sessions immediately when the security stamp changes
        // (e.g., on account soft-delete or admin suspension).
        // ValidationInterval = Zero re-checks the stamp against the DB on every authenticated request.
        builder.Services.Configure<SecurityStampValidatorOptions>(options =>
            options.ValidationInterval = TimeSpan.Zero);

        // BearerTokenHandler matches the "Bearer " prefix with StringComparison.Ordinal, so a token
        // sent as "authorization: bearer <token>" is rejected even though RFC 7235 §2.1 makes the
        // auth-scheme token case-insensitive — and Ocelot forwards headers verbatim. Parse the header
        // ourselves so the service, and the introspection endpoint that reports on it, agree.
        // The same hook revokes a token whose security stamp was rotated (#142): the handler has no
        // principal-validation event, so the stamp check runs here and fails the message.
        builder.Services.Configure<BearerTokenOptions>(IdentityConstants.BearerScheme, options =>
            options.Events.OnMessageReceived = async messageContext =>
            {
                messageContext.Token = BearerTokenHeader.Parse(
                    messageContext.Request.Headers.Authorization.ToString());
                await BearerStampCheck.RejectRevokedAsync(messageContext).ConfigureAwait(false);
            });

        // Resolves a forwarded cookie/bearer/API-key credential to an account id (see Routes/CredentialIntrospection.cs).
        builder.Services.AddScoped<CredentialIntrospector>();

        var app = builder.Build();

        if (!app.Services.GetRequiredService<IOptions<EmailCodeOptions>>().Value.IsConfigured)
        {
#pragma warning disable CA1848 // LoggerMessage delegates: matches the service's other log sites.
            app.Logger.LogWarning(EmailCodesNotConfiguredEvent, "Email codes are not configured: no usable EMAIL_CODE_HMAC_KEY. Every call is refused.");
#pragma warning restore CA1848
        }

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

        // Identity: login, refresh, forgotPassword, resetPassword, manage/*. /register, /confirmEmail and
        // /resendConfirmationEmail are retired (#657, stakeholder ruling 2026-10-07): only a verified code
        // creates an account. See Routes/IdentityEndpoints.cs.
        app.MapRetainedIdentityApi();

        // Sign-up before an account exists: POST /account/signup/{start,verify,resend,change-email}.
        // Creates no ApplicationUser. See Routes/SignUp.cs.
        app.MapSignUpRoutes();

        // POST /account/signup/complete: creates the account and signs it in. See Routes/SignUpComplete.cs.
        app.MapSignUpCompleteRoutes();

        // Password reset by code: POST /account/password/reset/{start,verify,complete}. See Routes/PasswordReset.cs.
        app.MapPasswordResetRoutes();

        // Email change: POST /account/email/change/{start,verify}. See Routes/EmailChange.cs.
        app.MapEmailChangeRoutes();

        // Email-first routing: POST /account/identify. See Routes/Identify.cs.
        app.MapIdentifyRoutes();

        // Profile: GET/PUT/DELETE /account/profile, GET /account/{userId}/history
        app.MapProfileRoutes();

        // Admin: GET/POST/DELETE /account/{userId}/roles
        app.MapAdminRoutes();

        // API Keys: POST/GET/DELETE /account/api-keys
        app.MapApiKeyRoutes();

        // Waitlist: GET/POST /account/waitlist, DELETE /account/waitlist/{interest}
        app.MapWaitlistRoutes();

        // Internal identity resolution: forwarded cookie/bearer/api-key -> account id
        app.MapCredentialIntrospectionRoutes();

        // Postmark bounce, spam complaint and subscription-change webhook (#664).
        app.MapPostmarkWebhookRoutes();

        await app.RunAsync().ConfigureAwait(false);
    }

    // The delivery queue is a singleton, so the suppression write opens its own scope.
    private static async Task RecordInactiveRecipientAsync(IServiceProvider services, string address, CancellationToken cancellationToken)
    {
        if (!SignUpEmail.TryNormalize(address, out var key, out _))
        {
            return;
        }

        using var scope = services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<EmailSuppressionService>()
            .SuppressAsync(key, EmailSuppression.InactiveRecipient, EmailSuppression.SendSource, cancellationToken)
            .ConfigureAwait(false);
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
            Roles.Agent,
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
