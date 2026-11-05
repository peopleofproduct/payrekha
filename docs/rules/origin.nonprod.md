# `origin.nonprod`

**Default verdict:** BLOCK

**Fires when:** The call comes from a non-production origin: the authenticated API key is marked `nonprod`, or the request carries a UAT/staging marker.

**Attack it answers:** Pivot from exposed UAT/staging into production payouts.

**Configuration:** Key origins in `PAYREKHA_API_KEYS`; `nonProdKeyIds`, `nonProdKeyPrefixes`, `unknownOrigin` (`ignore` or `review`).

**Known false positives:** A prod service accidentally using a UAT key. That is exactly what should stop.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
