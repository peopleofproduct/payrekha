# `origin.mismatch`

**Default verdict:** REVIEW

**Fires when:** A caller's _declared_ environment disagrees with the route origin it arrived on. Declare each caller once in `rules.origin.keyOrigins` (`sourceKeyId → 'prod'|'nonprod'`); any disagreement — either direction — is REVIEW evidence.

**Attack it answers:** The residual of the CRAFTY FALCON UAT→prod pivot — a credential you _intended_ for non-production quietly reaching the production payout route under a name that `nonProdKeyIds` / prefix conventions don't cover. On `/v1/evaluate` it also catches config drift: a key configured `origin: 'prod'` but declared `keyOrigins: nonprod` flags the disagreement instead of silently trusting the key's stamp.

**Relationship to `origin.nonprod`:** the hard rule runs first — a prod-declared caller on a nonprod route is already BLOCKed there. `origin.mismatch` is the evidence layer for what the hard rule can't see on a prod route. To _block_ a nonprod credential outright regardless of route, list it in `nonProdKeyIds`; `keyOrigins` flags disagreement, it does not pin.

**Configuration:** `rules.origin.keyOrigins` — `{"payout-service": "prod", "payout-uat": "nonprod"}`. Unlisted callers are ignored; `unknown` origins are handled by `unknownOrigin` on `origin.nonprod`.

**Known false positives:** intentional multi-environment callers — don't declare them (the rule only checks keys you pin).

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
