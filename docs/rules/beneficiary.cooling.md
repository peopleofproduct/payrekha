# `beneficiary.cooling`

**Default verdict:** REVIEW

**Fires when:** A payout at or above the threshold goes to a beneficiary first seen within the cooling window. Payouts with a valid intent bound to that beneficiary are exempt.

**Attack it answers:** Fresh mule accounts receiving large sums minutes after being added.

**Configuration:** `coolingMs` (default 30 min), `minAmountPaise` (default ₹50,000), `exemptBoundIntents` (default true).

**Known false positives:** First disbursals without intents (intent-less replay).

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
