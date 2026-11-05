# `client.unattested`

**Default verdict:** REVIEW

**Fires when:** App attestation is required for this kind and the payout has `clientAttested: false` or none.

**Attack it answers:** Repackaged mobile apps calling payout APIs directly.

**Configuration:** `requireAttestation` (list of kinds; off by default).

**Known false positives:** Server-to-server callers. Only enable it for app-initiated kinds.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
