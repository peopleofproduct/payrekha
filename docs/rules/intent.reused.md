# `intent.reused`

**Default verdict:** BLOCK

**Fires when:** The intent has already been used `maxUses` times (retries with the same `payoutId` are deduplicated, not counted).

**Attack it answers:** Draining one real intent many times.

**Configuration:** `maxUses` per intent.

**Known false positives:** Split disbursals (tranches). Issue one intent per tranche, or set `maxUses`.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
