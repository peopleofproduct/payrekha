// SPDX-License-Identifier: Apache-2.0
package city.theproduct.payrekha;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Round-trip against clients/vectors/intent-v1.json. No test framework: exits non-zero on failure. */
public final class IntentSignerTest {
  private static String field(String json, String name) {
    Matcher m = Pattern.compile("\"" + name + "\":\\s*(\"((?:[^\"\\\\]|\\\\.)*)\"|(\\d+))").matcher(json);
    if (!m.find()) throw new IllegalStateException("vector missing " + name);
    return m.group(2) != null ? m.group(2).replace("\\n", "\n").replace("\\\"", "\"") : m.group(3);
  }

  private static void check(String what, String expected, String actual) {
    if (!expected.equals(actual)) {
      System.err.println("FAIL " + what + "\n  expected " + expected + "\n  actual   " + actual);
      System.exit(1);
    }
    System.out.println("ok   " + what);
  }

  public static void main(String[] args) throws Exception {
    String vec = Files.readString(Path.of(args.length > 0 ? args[0] : "../vectors/intent-v1.json"));
    String intentJson = vec.substring(vec.indexOf("\"intent\""), vec.indexOf('}', vec.indexOf("\"intent\"")));
    Map<String, Object> intent = new LinkedHashMap<>();
    for (String k : new String[] {"intentId", "kind", "beneficiaryRef", "subjectRef", "issuer", "keyId"}) intent.put(k, field(intentJson, k));
    for (String k : new String[] {"maxAmountPaise", "maxUses", "notBeforeMs", "expiresAtMs"}) intent.put(k, Long.parseLong(field(intentJson, k)));

    check("payload", field(vec, "payload"), new String(IntentSigner.signingPayload(intent), java.nio.charset.StandardCharsets.UTF_8));
    check("hmac", field(vec, "hmacSignature"), IntentSigner.signHmac(intent, field(vec, "hmacSecret")));
    check("ed25519", field(vec, "ed25519Signature"), IntentSigner.signEd25519(intent, IntentSigner.ed25519FromSeed(HexFormat.of().parseHex(field(vec, "ed25519SeedHex")))));
    try {
      IntentSigner.canonicalJson(Map.of("a", 1.5));
      check("float rejected", "throws", "no throw");
    } catch (IllegalArgumentException e) {
      System.out.println("ok   float rejected");
    }
  }
}
