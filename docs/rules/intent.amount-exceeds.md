# `intent.amount-exceeds`

**Default verdict:** BLOCK

**Fires when:** `amountPaise` is above the intent's `maxAmountPaise` (or above what is left of it across uses).

**Attack it answers:** Inflating a sanctioned ₹2,40,000 loan to ₹24,00,000.

**Configuration:** None — the ceiling is the intent.

**Known false positives:** Fees added after sanction. Sign the intent for the gross disbursal amount.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
