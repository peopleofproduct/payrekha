// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
using System.Net.Http.Json;
using System.Text.Json;

namespace Payrekha;

public sealed class PayrekhaException : Exception
{
    public int Status { get; }
    public PayrekhaException(int status, string body) : base($"payrekha {status}: {body}") => Status = status;
}

/// <summary>Gateway client — System.Net.Http only. One instance per API-key role.</summary>
public sealed class PayrekhaClient
{
    private readonly HttpClient _http;
    private readonly string _base;
    private readonly string _token;

    public PayrekhaClient(string url, string token, TimeSpan? timeout = null, HttpClient? http = null)
    {
        _base = url.TrimEnd('/');
        _token = token;
        _http = http ?? new HttpClient { Timeout = timeout ?? TimeSpan.FromMilliseconds(5000) };
    }

    private async Task<JsonElement> Call(HttpMethod m, string path, object? body = null, string? token = null)
    {
        using var req = new HttpRequestMessage(m, _base + path);
        req.Headers.Authorization = new("Bearer", token ?? _token);
        if (body is not null) req.Content = JsonContent.Create(body);
        var res = await _http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode) throw new PayrekhaException((int)res.StatusCode, text);
        return JsonDocument.Parse(text).RootElement;
    }

    /// <summary>Evaluate a payout. Returns the verdict JSON (verdict, effectiveAction, decisionId, hits…).</summary>
    public Task<JsonElement> Evaluate(object payout, string? token = null) =>
        Call(HttpMethod.Post, "/v1/evaluate", payout, token);

    public Task<JsonElement> MintIntent(object body, string? token = null) =>
        Call(HttpMethod.Post, "/v1/intents/mint", body, token);

    public Task<JsonElement> RegisterIntent(object intent, string? token = null) =>
        Call(HttpMethod.Post, "/v1/intents", intent, token);

    public Task<JsonElement> Outcome(object body, string? token = null) =>
        Call(HttpMethod.Post, "/v1/outcomes", body, token);
}
