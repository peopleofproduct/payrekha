# `feed.reputation`

**Default verdict:** REVIEW or BLOCK

**Fires when:** The hashed beneficiary is on an operator-loaded fraud feed (your own or a consortium list, loaded from a file — no network calls).

**Attack it answers:** Known mule accounts.

**Configuration:** Feed file; `blockAt`, `reviewAt` risk bands.

**Known false positives:** Stale feed entries. Expire entries in your feed pipeline.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
