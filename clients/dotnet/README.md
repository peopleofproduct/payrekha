# Payrekha.Client — .NET

C# client for the PayRekha payout firewall — bank-side stacks. `net8.0`,
one dependency (BouncyCastle for Ed25519, which isn't in the BCL yet).

```bash
dotnet add package Payrekha.Client
```

## Sign an intent (system of record)

```csharp
using Payrekha;
using Org.BouncyCastle.Crypto.Parameters;

var key = IntentSigner.Ed25519FromPkcs8(Environment.GetEnvironmentVariable("LOS_SIGNING_KEY")!);
var intent = new Dictionary<string, object?> {
    ["intentId"] = "loan-88213", ["kind"] = "LOAN_DISBURSAL",
    ["maxAmountPaise"] = 24000000L, ["beneficiaryRef"] = ref_,
    ["maxUses"] = 1L, ["notBeforeMs"] = nowMs, ["expiresAtMs"] = nowMs + 86_400_000L,
    ["issuer"] = "los-prod", ["keyId"] = "los-2026-11" };
var signed = IntentSigner.SignEd25519(intent, key);
```

## Evaluate at payout time

```csharp
var client = new PayrekhaClient("http://payrekha:8080", apiKey);
var v = await client.Evaluate(new {
    payoutId, kind = "LOAN_DISBURSAL", intentId = signed["intentId"],
    amountPaise = 24000000L, beneficiaryRef = ref_, channel = "IMPS",
    sourceKeyId = "core-banking", origin = "prod", timestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
var action = v.GetProperty("effectiveAction").GetString(); // "ALLOW" | "HOLD" | "DECLINE"
```

## Conformance

```bash
cd tests/VectorTest && dotnet run
# verifies payload + HMAC + Ed25519 + beneficiaryRef against
# ../../vectors/intent-v1.json — the same vectors JS/Java/Go/Python run.
```

`Payrekha.Client` targets `net8.0`; `BouncyCastle.Cryptography` 2.4+.
