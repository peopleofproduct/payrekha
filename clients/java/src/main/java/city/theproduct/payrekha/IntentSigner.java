// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
package city.theproduct.payrekha;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Signs PayRekha payout intents inside a system of record (LOS/LMS,
 * settlement engine). JDK only (Ed25519 needs JDK 15+). Byte-for-byte
 * compatible with {@code signIntent()} in @payrekha/core.
 */
public final class IntentSigner {
  public static final String INTENT_DOMAIN = "payrekha-intent-v1\n";
  private static final long MAX_SAFE = 9007199254740991L;
  private static final byte[] PKCS8_ED25519_PREFIX = {
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20
  };

  private IntentSigner() {}

  /** Sorted keys, no whitespace, integers only, null fields dropped. */
  public static String canonicalJson(Object v) {
    StringBuilder sb = new StringBuilder();
    write(sb, v);
    return sb.toString();
  }

  private static void write(StringBuilder sb, Object v) {
    if (v == null) {
      sb.append("null");
    } else if (v instanceof String s) {
      quote(sb, s);
    } else if (v instanceof Boolean b) {
      sb.append(b);
    } else if (v instanceof Integer || v instanceof Long || v instanceof Short) {
      long n = ((Number) v).longValue();
      if (Math.abs(n) > MAX_SAFE) throw new IllegalArgumentException("integers must be JS-safe");
      sb.append(n);
    } else if (v instanceof Number) {
      throw new IllegalArgumentException("floats are not allowed; use integer paise / epoch ms");
    } else if (v instanceof Map<?, ?> m) {
      TreeMap<String, Object> sorted = new TreeMap<>();
      m.forEach((k, val) -> { if (val != null) sorted.put(String.valueOf(k), val); });
      sb.append('{');
      boolean first = true;
      for (Map.Entry<String, Object> e : sorted.entrySet()) {
        if (!first) sb.append(',');
        first = false;
        quote(sb, e.getKey());
        sb.append(':');
        write(sb, e.getValue());
      }
      sb.append('}');
    } else if (v instanceof List<?> l) {
      sb.append('[');
      for (int i = 0; i < l.size(); i++) {
        if (i > 0) sb.append(',');
        write(sb, l.get(i));
      }
      sb.append(']');
    } else {
      throw new IllegalArgumentException("unsupported type " + v.getClass().getName());
    }
  }

  private static void quote(StringBuilder sb, String s) {
    sb.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"' -> sb.append("\\\"");
        case '\\' -> sb.append("\\\\");
        case '\n' -> sb.append("\\n");
        case '\r' -> sb.append("\\r");
        case '\t' -> sb.append("\\t");
        case '\b' -> sb.append("\\b");
        case '\f' -> sb.append("\\f");
        default -> {
          if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
          else sb.append(c);
        }
      }
    }
    sb.append('"');
  }

  public static byte[] signingPayload(Map<String, Object> intent) {
    TreeMap<String, Object> body = new TreeMap<>(intent);
    body.remove("signature");
    return (INTENT_DOMAIN + canonicalJson(body)).getBytes(StandardCharsets.UTF_8);
  }

  /** HMAC-SHA256. Anyone holding the secret can mint intents — prefer Ed25519. */
  public static String signHmac(Map<String, Object> intent, String secret) throws GeneralSecurityException {
    if (secret.length() < 32) throw new IllegalArgumentException("HMAC secret must be at least 32 characters");
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    return b64url(mac.doFinal(signingPayload(intent)));
  }

  /** Ed25519 (default). Keep the key in your HSM/KMS where you can. */
  public static String signEd25519(Map<String, Object> intent, PrivateKey key) throws GeneralSecurityException {
    Signature s = Signature.getInstance("Ed25519");
    s.initSign(key);
    s.update(signingPayload(intent));
    return b64url(s.sign());
  }

  public static PrivateKey ed25519FromSeed(byte[] seed) throws GeneralSecurityException {
    if (seed.length != 32) throw new IllegalArgumentException("Ed25519 seed must be 32 bytes");
    byte[] der = new byte[PKCS8_ED25519_PREFIX.length + 32];
    System.arraycopy(PKCS8_ED25519_PREFIX, 0, der, 0, PKCS8_ED25519_PREFIX.length);
    System.arraycopy(seed, 0, der, PKCS8_ED25519_PREFIX.length, 32);
    return KeyFactory.getInstance("Ed25519").generatePrivate(new PKCS8EncodedKeySpec(der));
  }

  /** PKCS#8 DER, base64 — the format generateIssuerKeyPair() prints. */
  public static PrivateKey ed25519FromPkcs8(String base64) throws GeneralSecurityException {
    return KeyFactory.getInstance("Ed25519").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(base64)));
  }

  /** PEM ("-----BEGIN PRIVATE KEY-----") — the format openssl/HSM tooling exports. */
  public static PrivateKey ed25519FromPem(String pem) throws GeneralSecurityException {
    String b64 = pem.replaceAll("-----BEGIN [^-]+-----", "").replaceAll("-----END [^-]+-----", "").replaceAll("\\s", "");
    return ed25519FromPkcs8(b64);
  }

  private static String b64url(byte[] b) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
  }
}
