# Java / Spring

`clients/java` is plain JDK code: `java.net.http`, no JSON library. `PayrekhaClient` needs Java 11+; `IntentSigner` Ed25519 needs JDK 15+. Build and test with `sh clients/java/build.sh`.

```java
PayrekhaClient payrekha = new PayrekhaClient("http://payrekha:8080", System.getenv("PAYREKHA_API_KEY"));
// default fail mode: hold-above:5000000 (₹50,000), 500 ms timeout

@Service
class DisbursalService {
  Disbursal disburse(Loan loan) {
    Map<String, Object> p = Map.of(
        "payoutId", loan.disbursalId(), "kind", "LOAN_DISBURSAL", "intentId", loan.intentId(),
        "amountPaise", loan.amountPaise(), "beneficiaryRef", loan.beneficiaryRef(), "channel", "IMPS");
    PayrekhaClient.Verdict v = payrekha.evaluate(p);
    if (!v.mayProceed()) return Disbursal.held(v.decisionId, v.rules);
    return bank.send(loan);
  }
}
```

Sign intents in the LOS:

```java
PrivateKey key = IntentSigner.ed25519FromPkcs8(System.getenv("LOS_SIGNING_KEY"));
Map<String, Object> intent = new LinkedHashMap<>(Map.of(
    "intentId", "loan-88213", "kind", "LOAN_DISBURSAL", "maxAmountPaise", 24000000L,
    "beneficiaryRef", ref, "maxUses", 1L, "notBeforeMs", now, "expiresAtMs", now + 86_400_000L,
    "issuer", "los", "keyId", "los-2026-11"));
intent.put("signature", IntentSigner.signEd25519(intent, key));
payrekha.registerIntent(intent);
```
