# `calendar.window`

**Default verdict:** ALLOW (evidence only)

**Fires when:** The payout falls on a holiday, weekend or night window from the IST calendar. It sets the HOLIDAY state that tightens other rules.

**Attack it answers:** Attacks timed to Diwali, long weekends and nights.

**Configuration:** Calendar file, windows, multipliers.

**Known false positives:** —

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
