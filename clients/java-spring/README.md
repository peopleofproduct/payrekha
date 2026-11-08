# payrekha-spring-boot-starter

Auto-configures PayRekha for a Spring Boot payout service:

- `PayrekhaClient` bean when `payrekha.url` + `payrekha.api-key` are set —
  with the client-side fail mode (`onUnavailable`) enforced inside the
  client, matching the Envoy posture.
- `@PayrekhaCheck` — annotate the method that executes the payout; the
  aspect evaluates first and throws `PayrekhaDeniedException` on
  HOLD/DECLINE. The payout code never runs on a non-ALLOW.
- A `payrekhaIssuerKey` bean appears only when `payrekha.issuer-private-key`
  is set — the payout service should normally NOT have it (that key lives
  in the system of record); it's there for SoR-side apps.

```xml
<dependency>
  <groupId>city.theproduct.payrekha</groupId>
  <artifactId>payrekha-spring-boot-starter</artifactId>
  <version>0.1.0-alpha.2</version>
</dependency>
```

```yaml
payrekha:
  url: http://payrekha:8080
  api-key: ${PAYREKHA_API_KEY}        # env-injected, never in the yaml
  on-unavailable: hold-above:5000000  # hold > ₹50,000 when PayRekha is down
  timeout: 500ms
```

```java
@Service
class DisbursalService {
  @PayrekhaCheck("#payout")
  Disbursal disburse(Map<String, Object> payout, Loan loan) {
    return bank.send(loan);   // only runs on effectiveAction=ALLOW
  }
}
```

The signer path (SoR side):

```java
@Service
class IntentIssuer {
  private final PrivateKey key;          // injected payrekhaIssuerKey
  private final PayrekhaClient client;
  IntentIssuer(PrivateKey payrekhaIssuerKey, PayrekhaClient c) { key = payrekhaIssuerKey; client = c; }

  void issue(Loan loan) throws Exception {
    Map<String,Object> intent = new LinkedHashMap<>(Map.of(
        "intentId", loan.id(), "kind", "LOAN_DISBURSAL",
        "maxAmountPaise", loan.amountPaise(), "beneficiaryRef", loan.beneficiaryRef(),
        "maxUses", 1L, "notBeforeMs", now, "expiresAtMs", now + 86_400_000L,
        "issuer", "los-prod", "keyId", "los-2026-11"));
    intent.put("signature", IntentSigner.signEd25519(intent, key));
    client.registerIntent(intent);
  }
}
```

## Notes

- `payrekha.api-key` roles: evaluate needs a caller key; registering intents
  works with the same key only if it has the `intents` role — most
  deployments separate them (the payout service gets evaluate-only).
- `@PayrekhaCheck` throws `IllegalStateException` when the SpEL doesn't
  produce a `Map` — a misconfigured check fails loud, not silent.
- Compiled against Spring Boot 3.4 (`spring-boot-autoconfigure` +
  `spring-boot-starter-aop`, both `provided` scope — no dependency forcing).
