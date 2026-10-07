// <copyright file="PendingRegistrationPurgeService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>Deletes expired pending sign-ups on a timer. See <see cref="SignUpService.PurgeAsync"/>.</summary>
/// <param name="scopes">The scope factory, because the sign-up service is scoped.</param>
/// <param name="options">The sign-up options.</param>
/// <param name="timeProvider">The clock for the timer.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class PendingRegistrationPurgeService(
    IServiceScopeFactory scopes,
    IOptions<SignUpOptions> options,
    TimeProvider timeProvider,
    ILogger<PendingRegistrationPurgeService> logger) : BackgroundService
{
    /// <inheritdoc/>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(options.Value.PurgeInterval, timeProvider);
        try
        {
            do
            {
                await this.RunOnceAsync(stoppingToken).ConfigureAwait(false);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown.
        }
    }

    [LoggerMessage(1385, LogLevel.Information, "Purge of {Kind} removed {Count} rows.", EventName = "PendingRegistrationPurged")]
    private static partial void LogPurged(ILogger logger, string kind, int count);

    [LoggerMessage(1386, LogLevel.Error, "Purge of {Kind} failed: {Error}", EventName = "PendingRegistrationPurgeFailed")]
    private static partial void LogFailed(ILogger logger, string kind, string error);

    private async Task RunOnceAsync(CancellationToken stoppingToken)
    {
        // Each purge has its own scope and its own failure, so one cannot stop the other.
        await this.PurgeAsync("pending sign-ups", sp => sp.GetRequiredService<SignUpService>().PurgeAsync(stoppingToken)).ConfigureAwait(false);
        await this.PurgeAsync("password reset proofs", sp => sp.GetRequiredService<PasswordResetService>().PurgeAsync(stoppingToken)).ConfigureAwait(false);
        await this.PurgeAsync("security notice tokens", sp => sp.GetRequiredService<SecurityNoticeService>().PurgeAsync(stoppingToken)).ConfigureAwait(false);
        await this.PurgeAsync("email changes", sp => sp.GetRequiredService<EmailChangeService>().PurgeAsync(stoppingToken)).ConfigureAwait(false);
    }

    private async Task PurgeAsync(string kind, Func<IServiceProvider, Task<int>> purge)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var count = await purge(scope.ServiceProvider).ConfigureAwait(false);
            if (count > 0)
            {
                LogPurged(logger, kind, count);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // A failed pass must not stop the loop. The next tick retries.
            LogFailed(logger, kind, ex.GetType().Name);
        }
    }
}
