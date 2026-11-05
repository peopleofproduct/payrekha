# `probe.micro-then-large`

**Default verdict:** REVIEW (BLOCK in HIGH_ALERT)

**Fires when:** A micro payout (≤ ₹10 by default, firewall config `microPaise`) to a beneficiary is followed within the window by a large one (≥ ₹1,00,000 by default) — unless the micro was made under a valid `VERIFICATION` intent and the large one carries a valid bound intent.

**Attack it answers:** ₹1 test transfers before ₹4,99,999 ones.

**Configuration:** `windowMs`, `largePaise`, `largeMultiple`; HOLIDAY multipliers.

**Known false positives:** Lender penny-drop flows without intents — see [penny-drop.md](../penny-drop.md).

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
