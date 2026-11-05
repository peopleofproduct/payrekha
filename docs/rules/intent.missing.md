# `intent.missing`

**Default verdict:** BLOCK

**Fires when:** A payout of a kind that requires an intent (by default every kind; every kind without exception in HIGH_ALERT) arrives with no `intentId`, or the intent is unknown.

**Attack it answers:** A stolen payout API key used to send money nobody decided to send.

**Configuration:** Firewall config `requireIntent`, e.g. `{ "REFUND": false }` to opt a kind out (ignored in HIGH_ALERT).

**Known false positives:** An LMS migrated without intents yet. Run that kind in `shadow` via `modeByKind` until the LOS signs intents.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
