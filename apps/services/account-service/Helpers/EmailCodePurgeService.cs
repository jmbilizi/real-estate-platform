// <copyright file="EmailCodePurgeService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>Deletes spent email codes on a timer. See <see cref="EmailCodeService.PurgeAsync"/>.</summary>
/// <param name="scopes">The scope factory, because the code service is scoped.</param>
/// <param name="options">The engine options.</param>
/// <param name="timeProvider">The clock for the timer.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class EmailCodePurgeService(
    IServiceScopeFactory scopes,
    IOptions<EmailCodeOptions> options,
    TimeProvider timeProvider,
    ILogger<EmailCodePurgeService> logger) : BackgroundService
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

    [LoggerMessage(1382, LogLevel.Information, "Email code purge removed {Count} rows.", EventName = "EmailCodePurged")]
    private static partial void LogPurged(ILogger logger, int count);

    [LoggerMessage(1383, LogLevel.Error, "Email code purge failed: {Error}", EventName = "EmailCodePurgeFailed")]
    private static partial void LogFailed(ILogger logger, string error);

    private async Task RunOnceAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<EmailCodeService>();
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
