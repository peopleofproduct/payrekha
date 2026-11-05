# `settlement.account-changed`

**Default verdict:** REVIEW

**Fires when:** A settlement goes to a merchant whose settlement account changed within the cooling window (default 24 h).

**Attack it answers:** Attacker changes a merchant's settlement account, then triggers settlement.

**Configuration:** `coolingMs`.

**Known false positives:** Genuine account changes. Expect one review per change; that is the point.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
