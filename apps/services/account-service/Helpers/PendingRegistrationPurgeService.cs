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

    [LoggerMessage(1385, LogLevel.Information, "Pending sign-up purge removed {Count} rows.", EventName = "PendingRegistrationPurged")]
    private static partial void LogPurged(ILogger logger, int count);

    [LoggerMessage(1386, LogLevel.Error, "Pending sign-up purge failed: {Error}", EventName = "PendingRegistrationPurgeFailed")]
    private static partial void LogFailed(ILogger logger, string error);

    private async Task RunOnceAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<SignUpService>();
            var count = await service.PurgeAsync(stoppingToken).ConfigureAwait(false);
            if (count > 0)
            {
                LogPurged(logger, count);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // A failed pass must not stop the loop. The next tick retries.
            LogFailed(logger, ex.GetType().Name);
        }
    }
}
