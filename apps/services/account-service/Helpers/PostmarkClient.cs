// <copyright file="PostmarkClient.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text.Json;
using AccountService.Configuration;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>A thin wrapper over Postmark's transactional email HTTP API.</summary>
/// <remarks>
/// Composes the request only. Retry, the fail-closed check and every log statement live in
/// <see cref="PostmarkDeliveryQueue"/>, the one caller. This class never logs: the caller decides
/// what is safe to record, and the message body — which can carry a reset link or a confirmation
/// link — never passes through a log statement anywhere in this path.
/// </remarks>
/// <param name="httpClient">The Postmark-configured HTTP client.</param>
/// <param name="options">The Postmark options.</param>
internal sealed class PostmarkClient(HttpClient httpClient, IOptions<PostmarkOptions> options)
{
    // No naming policy, so a request is sent with property names exactly as declared, matching
    // Postmark's documented PascalCase field names independent of any ambient camelCase default.
    // Case-insensitive on the way in: Postmark's own casing is PascalCase, but a response should
    // never silently read back as all-default because of a casing mismatch.
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    /// <summary>Sends one message through Postmark's transactional API.</summary>
    /// <param name="message">The message to send.</param>
    /// <param name="cancellationToken">A token to cancel the request.</param>
    /// <returns>The outcome Postmark reported.</returns>
    /// <exception cref="HttpRequestException">The request could not reach Postmark.</exception>
    /// <exception cref="TaskCanceledException">The request timed out or was cancelled.</exception>
    internal async Task<PostmarkSendResult> SendAsync(OutboundEmail message, CancellationToken cancellationToken)
    {
        var settings = options.Value;
        using var request = new HttpRequestMessage(HttpMethod.Post, "email");
        request.Headers.Add("X-Postmark-Server-Token", settings.ServerToken);
        request.Headers.Add("Accept", "application/json");
        request.Content = JsonContent.Create(
            new PostmarkSendRequest(
                $"{message.FromName} <{message.FromAddress}>",
                message.To,
                message.ReplyToAddress,
                message.Subject,
                message.TextBody,
                settings.MessageStream),
            options: JsonOptions);

        using var response = await httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);

        // A malformed body (an intermediary's HTML error page, an empty body) is treated as a
        // failure result rather than an exception: an unhandled JsonException here would fault the
        // one background loop every future message goes through (#138 code review).
        PostmarkSendResponse payload;
        try
        {
            payload = await response.Content
                .ReadFromJsonAsync<PostmarkSendResponse>(JsonOptions, cancellationToken)
                .ConfigureAwait(false) ?? new PostmarkSendResponse();
        }
        catch (JsonException)
        {
            return new PostmarkSendResult(
                false,
                response.StatusCode,
                MessageId: null,
                ErrorCode: -1,
                Detail: "Postmark returned a response this client could not parse.");
        }

        return new PostmarkSendResult(
            response.IsSuccessStatusCode && payload.ErrorCode == 0,
            response.StatusCode,
            payload.MessageID,
            payload.ErrorCode,
            payload.Message ?? response.ReasonPhrase ?? "Postmark returned no detail.");
    }

    // Field names and casing match Postmark's documented request/response shape exactly.
    private sealed record PostmarkSendRequest(
        string From,
        string To,
        string ReplyTo,
        string Subject,
        string TextBody,
        string MessageStream);

    private sealed class PostmarkSendResponse
    {
        public string? MessageID { get; set; }

        public int ErrorCode { get; set; }

        public string? Message { get; set; }
    }
}
