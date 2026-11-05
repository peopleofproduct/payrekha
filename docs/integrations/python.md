# Python

`clients/python` uses only the standard library. Ed25519 signing needs the optional `cryptography` package.

```python
from payrekha import PayrekhaClient, hash_beneficiary, sign_intent_ed25519

client = PayrekhaClient("http://payrekha:8080", api_key, on_unavailable="hold-above:5000000", timeout_s=0.5)

ref = hash_beneficiary(HASH_KEY, account="000123456789", ifsc="HDFC0001234")
client.register_intent(sign_intent_ed25519({
    "intentId": "wd-1182", "kind": "VDA_WITHDRAWAL", "maxAmountPaise": 1_50_000_00,
    "beneficiaryRef": ref, "maxUses": 1, "notBeforeMs": now, "expiresAtMs": now + 3_600_000,
    "issuer": "withdrawals", "keyId": "wd-2026-11"}, private_key))

v = client.evaluate({"payoutId": "po-1", "kind": "VDA_WITHDRAWAL", "intentId": "wd-1182",
                     "amountPaise": 1_50_000_00, "beneficiaryRef": ref, "channel": "IMPS"})
if v["effectiveAction"] != "ALLOW":
    hold(v)
```

If the gateway is unreachable, `evaluate` does not raise. It returns a degraded verdict with `"unavailable": True`, using the fail mode you configured.
