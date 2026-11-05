# `settlement.over-captured`

**Default verdict:** BLOCK

**Fires when:** A `PA_SETTLEMENT` payout exceeds the reconciled captured net, carried as the settlement intent's `maxAmountPaise`.

**Attack it answers:** Abuse of payment-aggregator settlement APIs to settle more than was collected.

**Configuration:** None — the reconciliation engine signs the ceiling.

**Known false positives:** Late-captured transactions. Include them in the reconciled amount before settling.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
