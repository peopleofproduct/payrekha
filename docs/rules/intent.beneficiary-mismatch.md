# `intent.beneficiary-mismatch`

**Default verdict:** BLOCK

**Fires when:** The payout's hashed beneficiary differs from the intent's `beneficiaryRef`.

**Attack it answers:** A real intent replayed to the attacker's mule account.

**Configuration:** None.

**Known false positives:** Borrower changes bank account after sanction. Re-issue the intent with the new beneficiary.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
