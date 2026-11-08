// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
package city.theproduct.payrekha.spring;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** payrekha.* application properties. */
@ConfigurationProperties(prefix = "payrekha")
public class PayrekhaProperties {
  /** Gateway base URL, e.g. http://payrekha:8080. */
  private String url;
  /** API key for the caller's role (evaluate). Prefer env-injected. */
  private String apiKey;
  /**
   * Behaviour when the gateway is unreachable: {@code hold} (everything),
   * {@code hold-above:<paise>} (default, holds only payouts above the
   * threshold), or {@code allow} (shadow-mode trials only).
   */
  private String onUnavailable = "hold-above:5000000";
  /** Evaluate call timeout. The gateway's own budget is ~250 ms. */
  private Duration timeout = Duration.ofMillis(500);
  /** Intent-signing key material — PKCS8 base64 or PEM. Keep in vault/env. */
  private String issuerPrivateKey;
  /** Issuer id + keyId stamped on signed intents (e.g. los-prod / los-2026-11). */
  private String issuer;
  private String keyId;

  public String getUrl() { return url; }
  public void setUrl(String url) { this.url = url; }
  public String getApiKey() { return apiKey; }
  public void setApiKey(String apiKey) { this.apiKey = apiKey; }
  public String getOnUnavailable() { return onUnavailable; }
  public void setOnUnavailable(String onUnavailable) { this.onUnavailable = onUnavailable; }
  public Duration getTimeout() { return timeout; }
  public void setTimeout(Duration timeout) { this.timeout = timeout; }
  public String getIssuerPrivateKey() { return issuerPrivateKey; }
  public void setIssuerPrivateKey(String issuerPrivateKey) { this.issuerPrivateKey = issuerPrivateKey; }
  public String getIssuer() { return issuer; }
  public void setIssuer(String issuer) { this.issuer = issuer; }
  public String getKeyId() { return keyId; }
  public void setKeyId(String keyId) { this.keyId = keyId; }
}
