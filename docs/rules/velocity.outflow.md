# `velocity.outflow`

**Default verdict:** REVIEW; BLOCK above the hard cap (2× budget)

**Fires when:** Count or sum of payouts in the window exceeds the budget for the calling API key, the merchant, or globally. Budgets shrink in HOLIDAY and HIGH_ALERT.

**Attack it answers:** Machine-speed draining through one credential.

**Configuration:** `windowMs`, `perSourceKey`, `perSourceKeyOverrides`, `perMerchant`, `global`, `hardCapFactor`.

**Known false positives:** Batch callers (nightly settlement, AP runs). Give them their own budget with `perSourceKeyOverrides`.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
