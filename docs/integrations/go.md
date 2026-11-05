# Go

`clients/go` uses only the standard library, including `crypto/ed25519`. It needs Go 1.22 or later. Its signatures are byte-for-byte identical to `@payrekha/core`; the test vector in `clients/vectors/intent-v1.json` checks this.

```bash
go get github.com/peopleofproduct/payrekha/clients/go
```

```go
import payrekha "github.com/peopleofproduct/payrekha/clients/go"

c, err := payrekha.NewClient("http://payrekha:8080", os.Getenv("PAYREKHA_API_KEY"), payrekha.DefaultOnUnavailable, 500*time.Millisecond)

// In the system of record (LOS, withdrawal approver): sign and register the intent.
ref, _ := payrekha.HashBeneficiary(payrekha.Beneficiary{Account: "000123456789", IFSC: "HDFC0001234"}, hashKey)
intent, _ := payrekha.SignEd25519(map[string]any{
	"intentId": "wd-1182", "kind": "VDA_WITHDRAWAL", "maxAmountPaise": int64(1_50_000_00),
	"beneficiaryRef": ref, "maxUses": 1, "notBeforeMs": now, "expiresAtMs": now + 3_600_000,
	"issuer": "withdrawals", "keyId": "wd-2026-11",
}, privateKey)
_, err = c.RegisterIntent(ctx, intent)

// In the payout service: ask before the money moves.
v, err := c.Evaluate(ctx, map[string]any{
	"payoutId": "po-1", "kind": "VDA_WITHDRAWAL", "intentId": "wd-1182",
	"amountPaise": int64(1_50_000_00), "beneficiaryRef": ref, "channel": "IMPS",
})
if err != nil || !v.MayProceed() {
	return hold(v.DecisionID, v.Rules())
}
```

- **Gateway unreachable, or a 5xx answer:** `Evaluate` returns no error. It returns a degraded verdict with `Unavailable: true`, decided by the fail mode. The default is `hold-above:5000000`: hold anything above ₹50,000.
- **Auth or request errors (4xx):** these are returned as `*payrekha.HTTPError`, so a misconfigured key shows up instead of being hidden behind the fail mode.
- **Amounts and times:** use integer paise and epoch milliseconds. Floats are rejected when signing.
