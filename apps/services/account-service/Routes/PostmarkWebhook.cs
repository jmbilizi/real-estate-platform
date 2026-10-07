// <copyright file="PostmarkWebhook.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AccountService.Configuration;
using AccountService.Dtos;
using AccountService.Helpers;
using AccountService.Models;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace AccountService.Routes;

/// <summary>
/// <c>POST /account/webhooks/postmark</c>: the Postmark Bounce, SpamComplaint and SubscriptionChange
/// webhooks (#664). Postmark calls it with HTTP Basic credentials from configuration.
/// </summary>
/// <remarks>
/// <para>
/// The gateway route is public because Postmark must reach the endpoint from the internet. The Basic
/// credential is the only gate, so an unset credential closes the endpoint: every call gets 401. The
/// path is not under <c>/internal</c> on purpose: <c>InternalRoutesNotExposedTests</c> forbids a
/// gateway route to <c>/internal</c>, and the introspection endpoint lives there.
/// </para>
/// <para>
/// Every handled event is idempotent. A repeated event changes nothing. An event the service does not
/// act on (a soft bounce, another message stream, an unknown record type) answers 200, so Postmark
/// does not retry it. Nothing here logs the address or the body.
/// </para>
/// </remarks>
internal static partial class PostmarkWebhook
{
    internal const string Path = "/account/webhooks/postmark";

    // A Postmark event is under 10 KB. The cap stops an unauthenticated read from buffering a large body,
    // although the credential check runs first.
    private const int MaxBodyBytes = 64 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    internal static IEndpointRouteBuilder MapPostmarkWebhookRoutes(this IEndpointRouteBuilder app)
    {
        app.MapPost(Path, HandleAsync);
        return app;
    }

    [LoggerMessage(1390, LogLevel.Information, "Postmark {RecordType} event handled: {Outcome}.", EventName = "PostmarkWebhookHandled")]
    private static partial void LogHandled(ILogger logger, string recordType, string outcome);

    [LoggerMessage(1391, LogLevel.Warning, "Postmark webhook refused: the credentials are missing, wrong or not configured.", EventName = "PostmarkWebhookUnauthorized")]
    private static partial void LogUnauthorized(ILogger logger);

    private static async Task<IResult> HandleAsync(
        HttpContext http,
        IOptions<PostmarkOptions> options,
        EmailSuppressionService suppressions,
        ILoggerFactory loggers)
    {
        var settings = options.Value;
        var logger = loggers.CreateLogger("AccountService.PostmarkWebhook");
        if (!IsAuthorized(http.Request.Headers.Authorization.ToString(), settings))
        {
            LogUnauthorized(logger);
            http.Response.Headers[HeaderNames.WWWAuthenticate] = "Basic realm=\"postmark\"";
            return Results.StatusCode(StatusCodes.Status401Unauthorized);
        }

        PostmarkEvent? payload;
        try
        {
            using var body = new MemoryStream();
            await CopyLimitedAsync(http.Request.Body, body, http.RequestAborted).ConfigureAwait(false);
            payload = JsonSerializer.Deserialize<PostmarkEvent>(body.ToArray(), JsonOptions);
        }
        catch (JsonException)
        {
            return Results.StatusCode(StatusCodes.Status400BadRequest);
        }
        catch (InvalidDataException)
        {
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        if (payload?.RecordType is null)
        {
            return Results.StatusCode(StatusCodes.Status400BadRequest);
        }

        // Suppression is per message stream. A bounce on another stream says nothing about the
        // transactional stream this service sends on.
        if (!string.IsNullOrEmpty(payload.MessageStream)
            && !string.Equals(payload.MessageStream, settings.MessageStream, StringComparison.OrdinalIgnoreCase))
        {
            LogHandled(logger, Known(payload.RecordType), "other stream, ignored");
            return Results.Ok();
        }

        var outcome = await ApplyAsync(payload, suppressions, http.RequestAborted).ConfigureAwait(false);
        LogHandled(logger, Known(payload.RecordType), outcome);
        return Results.Ok();
    }

    private static async Task<string> ApplyAsync(PostmarkEvent payload, EmailSuppressionService suppressions, CancellationToken cancellationToken)
    {
        switch (payload.RecordType)
        {
            case "Bounce":
                // A soft bounce leaves the address active. Only a hard bounce sets Inactive.
                if (payload.Inactive != true || !TryKey(payload.Email, out var bounced))
                {
                    return "ignored";
                }

                await suppressions.SuppressAsync(bounced, EmailSuppression.HardBounce, EmailSuppression.WebhookSource, cancellationToken).ConfigureAwait(false);
                return "suppressed";
            case "SpamComplaint":
                if (!TryKey(payload.Email, out var complained))
                {
                    return "ignored";
                }

                await suppressions.SuppressAsync(complained, EmailSuppression.SpamComplaint, EmailSuppression.WebhookSource, cancellationToken).ConfigureAwait(false);
                return "suppressed";
            case "SubscriptionChange":
                if (!TryKey(payload.Recipient, out var changed) || payload.SuppressSending is null)
                {
                    return "ignored";
                }

                if (payload.SuppressSending == true)
                {
                    await suppressions.SuppressAsync(changed, ReasonFor(payload.SuppressionReason), EmailSuppression.WebhookSource, cancellationToken).ConfigureAwait(false);
                    return "suppressed";
                }

                await suppressions.ReactivateAsync(changed, cancellationToken).ConfigureAwait(false);
                return "reactivated";
            default:
                return "ignored";
        }
    }

    // An unknown reason still suppresses: Postmark said sending must stop.
    private static string ReasonFor(string? reason) => reason switch
    {
        EmailSuppression.HardBounce => EmailSuppression.HardBounce,
        EmailSuppression.SpamComplaint => EmailSuppression.SpamComplaint,
        _ => EmailSuppression.ManualSuppression,
    };

    // The log carries only a known type, never text from the body.
    private static string Known(string recordType) =>
        recordType is "Bounce" or "SpamComplaint" or "SubscriptionChange" ? recordType : "other";

    private static bool TryKey(string? address, out string key) => SignUpEmail.TryNormalize(address, out key, out _);

    private static async Task CopyLimitedAsync(Stream source, Stream destination, CancellationToken cancellationToken)
    {
        var buffer = new byte[8192];
        var total = 0;
        int read;
        while ((read = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) > 0)
        {
            total += read;
            if (total > MaxBodyBytes)
            {
                throw new InvalidDataException("The webhook body is too large.");
            }

            await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
        }
    }

    private static bool IsAuthorized(string header, PostmarkOptions settings)
    {
        // Run the same work for every failure, so a missing header costs the same as a wrong one.
        var user = string.Empty;
        var password = string.Empty;
        var parsed = false;
        if (header.StartsWith("Basic ", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(header["Basic ".Length..].Trim()));
                var colon = decoded.IndexOf(':', StringComparison.Ordinal);
                if (colon >= 0)
                {
                    user = decoded[..colon];
                    password = decoded[(colon + 1)..];
                    parsed = true;
                }
            }
            catch (FormatException)
            {
                // Not Base64. Treated as no credentials.
            }
        }

        var userMatches = Equal(user, settings.WebhookUser);
        var passwordMatches = Equal(password, settings.WebhookPassword);
        return parsed && settings.IsWebhookConfigured && userMatches && passwordMatches;
    }

    // Hash first, so the compare takes a fixed time whatever the lengths.
    private static bool Equal(string submitted, string expected) =>
        CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(submitted)),
            SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
}
