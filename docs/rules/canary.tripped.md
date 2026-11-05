# `canary.tripped`

**Default verdict:** BLOCK + HIGH_ALERT

**Fires when:** The payout touches a canary: a planted beneficiary, a decoy API key, or a honey intent.

**Attack it answers:** Attackers exploring with data they found inside.

**Configuration:** `POST /v1/canaries`.

**Known false positives:** None by design — nothing legitimate should touch a canary.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
