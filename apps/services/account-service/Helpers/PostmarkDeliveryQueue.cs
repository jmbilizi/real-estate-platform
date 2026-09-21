// <copyright file="PostmarkDeliveryQueue.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Threading.Channels;
using AccountService.Configuration;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// The one Postmark transport. Queues a message and returns immediately, so no caller of
/// <see cref="IOutboundEmailSender"/> — an Identity handler least of all — ever waits on the
/// network. A background loop drains the queue, retrying a transport failure a bounded number of
/// times before giving up loudly.
/// </summary>
/// <remarks>
/// <para>
/// The queue is in-memory only. A process restart loses whatever is still queued; there is no
/// durable outbox in this ticket's scope (#138). Given the size of the request queue in practice
/// (recovery and confirmation traffic, not bulk mail) and that a lost message costs the consumer
/// nothing worse than asking again, this is an accepted trade-off, not an oversight.
/// </para>
/// <para>
/// Non-production safety is enforced here, not by trusting a sandbox token alone: if
/// <see cref="PostmarkOptions.IsConfigured"/> is false — the committed secret placeholder was never
/// substituted — nothing is sent, and that is logged loudly rather than silently discarded.
/// </para>
/// </remarks>
/// <param name="client">The Postmark HTTP client.</param>
/// <param name="options">The Postmark options.</param>
/// <param name="logger">The logger.</param>
/// <param name="timeProvider">The time provider, for retry delays a test can control.</param>
/// <param name="retryDelays">
/// The delay before each retry. Defaults to production delays; a test supplies short ones so a
/// retry test does not run for a minute of wall-clock time.
/// </param>
internal sealed partial class PostmarkDeliveryQueue(
    PostmarkClient client,
    IOptions<PostmarkOptions> options,
    ILogger<PostmarkDeliveryQueue> logger,
    TimeProvider timeProvider,
    IReadOnlyList<TimeSpan>? retryDelays = null) : BackgroundService, IOutboundEmailSender
{
    private static readonly IReadOnlyList<TimeSpan> DefaultRetryDelays =
    [
        TimeSpan.FromSeconds(2),
        TimeSpan.FromSeconds(10),
        TimeSpan.FromSeconds(30),
    ];

    private readonly IReadOnlyList<TimeSpan> retryDelays = retryDelays ?? DefaultRetryDelays;

    private readonly Channel<OutboundEmail> queue =
        Channel.CreateUnbounded<OutboundEmail>(new UnboundedChannelOptions { SingleReader = true });

    /// <summary>
    /// Raised once per queued message, after delivery has been attempted and either succeeded,
    /// been rejected, or exhausted its retries. A test awaits this instead of sleeping.
    /// </summary>
    internal event Action<OutboundEmail>? Delivered;

    /// <inheritdoc/>
    public Task SendAsync(OutboundEmail message, CancellationToken cancellationToken = default) =>
        this.queue.Writer.WriteAsync(message, cancellationToken).AsTask();

    /// <inheritdoc/>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var message in this.queue.Reader.ReadAllAsync(stoppingToken).ConfigureAwait(false))
        {
            await this.DeliverAsync(message, stoppingToken).ConfigureAwait(false);
            this.Delivered?.Invoke(message);
        }
    }

    [LoggerMessage(1370, LogLevel.Warning, "{Kind} for {To} was not sent: Postmark is not configured for this environment. The message was discarded.", EventName = "PostmarkSendSuppressed")]
    private static partial void LogSuppressed(ILogger logger, EmailKind kind, string to);

    [LoggerMessage(1371, LogLevel.Information, "{Kind} for {To} accepted by Postmark, MessageID {MessageId}.", EventName = "PostmarkSendAccepted")]
    private static partial void LogAccepted(ILogger logger, EmailKind kind, string to, string messageId);

    [LoggerMessage(1372, LogLevel.Error, "{Kind} for {To} was rejected by Postmark (ErrorCode {ErrorCode}): {Detail}", EventName = "PostmarkSendRejected")]
    private static partial void LogRejected(ILogger logger, EmailKind kind, string to, int errorCode, string detail);

    [LoggerMessage(1373, LogLevel.Error, "{Kind} for {To} could not be delivered after retries: {Detail}", EventName = "PostmarkSendFailedAfterRetries")]
    private static partial void LogFailed(ILogger logger, EmailKind kind, string to, string detail);

    private async Task DeliverAsync(OutboundEmail message, CancellationToken cancellationToken)
    {
        if (!options.Value.IsConfigured)
        {
            LogSuppressed(logger, message.Kind, message.To);
            return;
        }

        for (var attempt = 0; ; attempt++)
        {
            try
            {
                var result = await client.SendAsync(message, cancellationToken).ConfigureAwait(false);
                if (result.Success)
                {
                    LogAccepted(logger, message.Kind, message.To, result.MessageId ?? string.Empty);
                    return;
                }

                // Postmark rejected the request at the API level (bad token, invalid recipient,
                // suppressed address). Retrying would not change that outcome.
                LogRejected(logger, message.Kind, message.To, result.ErrorCode, result.Detail);
                return;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                if (attempt >= this.retryDelays.Count)
                {
                    LogFailed(logger, message.Kind, message.To, ex.Message);
                    return;
                }

                await Task.Delay(this.retryDelays[attempt], timeProvider, cancellationToken).ConfigureAwait(false);
            }
        }
    }
}
