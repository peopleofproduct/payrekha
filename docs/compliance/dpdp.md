# DPDP Act 2023 — data minimisation as a control

The Digital Personal Data Protection Act's minimisation principle is
where PayRekha's design does real work: **raw account numbers, VPAs,
mobile numbers and VDA addresses never enter the system.**

## The mechanism

- `hashBeneficiary(id, key)` → `hb1_<base64url>` — a keyed HMAC-SHA256
  (`packages/core/src/hash.ts`). Without the operator's key a ref cannot
  be dictionary-reversed — critical for 10-digit mobiles and `name@bank`
  VPAs, which a plain hash would enumerate in seconds.
- The key is operator-supplied (`PAYREKHA_HASH_KEY`, ≥16 chars) and must
  be identical wherever refs are produced — LOS signing intents, payout
  service, gateway.
- `hashAtEntry` on the gateway hashes raw beneficiary fields **at the
  edge** over TLS, so downstream state, snapshots, and the decision log
  hold only `hb1_` refs.
- `decisionRecord`'s `safe()` drops any `beneficiaryRef` that doesn't
  start with `hb1_` — the log physically cannot carry a raw identifier
  even if a caller sends one (`packages/gateway/src/log.ts`).

## What an assessor can verify

```sh
# decision log contains only hashed refs (empty output = pass)
grep -o '"beneficiaryRef":"[^"]*"' decisions.jsonl | grep -v 'hb1_' || echo PASS
```

| DPDP theme         | Status                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minimisation       | **Strong** — the product's data model is "hashed refs + amounts + rule ids"; there is no field to hold a name, PAN, address, or raw identifier                                               |
| Purpose limitation | Verdict + audit only; no profiling export exists in the codebase                                                                                                                             |
| Storage limitation | Intent/reservation/snapshot retention is bounded (`reservationRetentionDays`, ring/ledger bounds); raw PII never arrives to retain                                                           |
| Breach impact      | A stolen `decisions.jsonl` or snapshot leaks `hb1_` refs + amounts — meaningful exposure requires the HMAC key too. **Keep `PAYREKHA_HASH_KEY` in the secret manager with the signing keys** |
| Consent/notice/DSR | **Operator** — PayRekha processes refs, not data principals; DSR workflows run against your system of record which holds the key↔identity mapping                                            |

The honest boundary: minimisation makes PayRekha a _small_ data surface,
not a zero one — `payoutId`, `merchantId`, `sourceHint` (IPs) are still
identifiers in your logs; treat them accordingly.
