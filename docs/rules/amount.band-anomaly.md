# `amount.band-anomaly`

**Default verdict:** REVIEW

**Fires when:** The amount is far above the rolling median + k×MAD band for that kind and source key, after a minimum sample.

**Attack it answers:** Unusual large payouts from a caller that normally sends small ones.

**Configuration:** `sampleSize`, `minSamples`, `threshold`, `excludeKinds`.

**Known false positives:** Month-end or festival spikes. Tune `threshold` with replay.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
