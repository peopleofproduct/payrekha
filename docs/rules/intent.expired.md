# `intent.expired`

**Default verdict:** BLOCK

**Fires when:** The payout time is before `notBeforeMs` or after `expiresAtMs`.

**Attack it answers:** Old intents harvested from logs or exports and replayed later.

**Configuration:** None.

**Known false positives:** Disbursals queued over a long weekend. Issue intents with a validity window that covers your real queue time.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
