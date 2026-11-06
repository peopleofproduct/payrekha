// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
package city.theproduct.payrekha;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Gateway client: java.net.http only, no JSON library. Java 11+.
 * When the gateway is unreachable the configured fail mode decides —
 * default {@code hold-above:5000000} (hold anything above ₹50,000).
 */
public final class PayrekhaClient {
  public static final String DEFAULT_ON_UNAVAILABLE = "hold-above:5000000";

  /** The parts of a verdict a payout service acts on. */
  public static final class Verdict {
    public final String verdict;
    public final String effectiveAction;
    public final String decisionId;
    public final List<String> rules;
    public final boolean degraded;
    public final boolean unavailable;

    Verdict(String verdict, String effectiveAction, String decisionId, List<String> rules, boolean degraded, boolean unavailable) {
      this.verdict = verdict;
      this.effectiveAction = effectiveAction;
      this.decisionId = decisionId;
      this.rules = rules;
      this.degraded = degraded;
      this.unavailable = unavailable;
    }

    public boolean mayProceed() {
      return "ALLOW".equals(effectiveAction);
    }
  }

  private final HttpClient http;
  private final URI base;
  private final String apiKey;
  private final long holdAbove; // Long.MAX_VALUE = allow all, -1 = hold all
  private final Duration timeout;

  public PayrekhaClient(String baseUrl, String apiKey) {
    this(baseUrl, apiKey, DEFAULT_ON_UNAVAILABLE, Duration.ofMillis(500));
  }

  public PayrekhaClient(String baseUrl, String apiKey, String onUnavailable, Duration timeout) {
    this.base = URI.create(baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
    this.apiKey = apiKey;
    this.timeout = timeout;
    this.http = HttpClient.newBuilder().connectTimeout(timeout).build();
    if ("allow".equals(onUnavailable)) holdAbove = Long.MAX_VALUE;
    else if ("hold".equals(onUnavailable)) holdAbove = -1;
    else if (onUnavailable.startsWith("hold-above:")) holdAbove = Long.parseLong(onUnavailable.substring(11));
    else throw new IllegalArgumentException("onUnavailable must be allow, hold or hold-above:<paise>");
  }

  /** Evaluate a payout (a flat map: payoutId, kind, amountPaise, beneficiaryRef, intentId, channel, …). */
  public Verdict evaluate(Map<String, Object> payout) {
    try {
      Object parsed = call("v1/evaluate", payout);
      @SuppressWarnings("unchecked")
      Map<String, Object> v = (Map<String, Object>) parsed;
      List<String> rules = new ArrayList<>();
      Object hits = v.get("hits");
      if (hits instanceof List) for (Object h : (List<?>) hits) if (h instanceof Map) rules.add(String.valueOf(((Map<?, ?>) h).get("rule")));
      return new Verdict(String.valueOf(v.get("verdict")), String.valueOf(v.get("effectiveAction")), String.valueOf(v.get("decisionId")), rules, Boolean.TRUE.equals(v.get("degraded")), false);
    } catch (IOException | RuntimeException e) {
      Object a = payout.get("amountPaise");
      long amount = a instanceof Number ? ((Number) a).longValue() : Long.MAX_VALUE;
      boolean hold = holdAbove < 0 || (holdAbove != Long.MAX_VALUE && amount > holdAbove);
      return new Verdict(hold ? "REVIEW" : "ALLOW", hold ? "HOLD" : "ALLOW", null, List.of(), true, true);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return new Verdict("REVIEW", "HOLD", null, List.of(), true, true);
    }
  }

  /** Register a signed intent (see {@link IntentSigner}). Returns the parsed response. */
  public Object registerIntent(Map<String, Object> intent) throws IOException, InterruptedException {
    return call("v1/intents", intent);
  }

  private Object call(String path, Map<String, Object> body) throws IOException, InterruptedException {
    HttpRequest req = HttpRequest.newBuilder(base.resolve(path))
        .timeout(timeout)
        .header("authorization", "Bearer " + apiKey)
        .header("content-type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(IntentSigner.canonicalJson(body)))
        .build();
    HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
    if (res.statusCode() >= 500 || res.statusCode() == 401) throw new IOException("gateway status " + res.statusCode());
    return new Json(res.body()).value();
  }

  /** Minimal JSON reader for gateway responses. */
  static final class Json {
    private final String s;
    private int i;

    Json(String s) {
      this.s = s;
    }

    Object value() {
      ws();
      char c = s.charAt(i);
      if (c == '{') {
        Map<String, Object> m = new LinkedHashMap<>();
        i++;
        ws();
        if (s.charAt(i) == '}') { i++; return m; }
        while (true) {
          ws();
          String k = str();
          ws();
          i++; // :
          m.put(k, value());
          ws();
          if (s.charAt(i++) == '}') return m;
        }
      }
      if (c == '[') {
        List<Object> l = new ArrayList<>();
        i++;
        ws();
        if (s.charAt(i) == ']') { i++; return l; }
        while (true) {
          l.add(value());
          ws();
          if (s.charAt(i++) == ']') return l;
        }
      }
      if (c == '"') return str();
      if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
      if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
      if (s.startsWith("null", i)) { i += 4; return null; }
      int st = i;
      while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
      String n = s.substring(st, i);
      return n.matches("-?\\d+") ? (Object) Long.parseLong(n) : (Object) Double.parseDouble(n);
    }

    private void ws() {
      while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
    }

    private String str() {
      StringBuilder b = new StringBuilder();
      i++;
      while (true) {
        char c = s.charAt(i++);
        if (c == '"') return b.toString();
        if (c != '\\') { b.append(c); continue; }
        char e = s.charAt(i++);
        switch (e) {
          case 'n': b.append('\n'); break;
          case 't': b.append('\t'); break;
          case 'r': b.append('\r'); break;
          case 'b': b.append('\b'); break;
          case 'f': b.append('\f'); break;
          case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
          default: b.append(e);
        }
      }
    }
  }
}
