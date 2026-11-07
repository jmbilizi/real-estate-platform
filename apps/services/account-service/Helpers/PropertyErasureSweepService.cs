// <copyright file="PropertyErasureSweepService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>Runs <see cref="PropertyErasureService.DrainAsync"/> on a timer (#803).</summary>
/// <param name="scopes">The scope factory, because the erasure service is scoped.</param>
/// <param name="options">The erasure options.</param>
/// <param name="timeProvider">The clock for the timer.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class PropertyErasureSweepService(
    IServiceScopeFactory scopes,
    IOptions<PropertyErasureOptions> options,
    TimeProvider timeProvider,
    ILogger<PropertyErasureSweepService> logger) : BackgroundService
{
    /// <inheritdoc/>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // The first pass waits one interval, so a restart does not call property-service at once.
        using var timer = new PeriodicTimer(options.Value.SweepInterval, timeProvider);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
            {
                await this.RunOnceAsync(stoppingToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown.
        }
    }

    [LoggerMessage(1392, LogLevel.Information, "Property data erasure completed for {Count} accounts.", EventName = "PropertyErasureCompleted")]
    private static partial void LogCompleted(ILogger logger, int count);

    [LoggerMessage(1393, LogLevel.Error, "Property data erasure sweep failed: {Error}", EventName = "PropertyErasureSweepFailed")]
    private static partial void LogSweepFailed(ILogger logger, string error);

    private async Task RunOnceAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<PropertyErasureService>();
            var count = await service.DrainAsync(stoppingToken).ConfigureAwait(false);
            if (count > 0)
            {
                LogCompleted(logger, count);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // A failed pass must not stop the loop. The next tick retries.
            LogSweepFailed(logger, ex.GetType().Name);
        }
    }
}
