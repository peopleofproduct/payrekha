# `intent.kind-mismatch`

**Default verdict:** BLOCK

**Fires when:** The payout's kind differs from the intent's kind (a `REFUND` intent used for a `LOAN_DISBURSAL`).

**Attack it answers:** Laundering a low-scrutiny intent into a high-value payout type.

**Configuration:** None.

**Known false positives:** A payout service that labels kinds differently from the LOS. Fix the mapping.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
