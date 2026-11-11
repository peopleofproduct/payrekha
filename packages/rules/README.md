# @payrekha/rules

The default payout rule chain for [PayRekha](https://github.com/peopleofproduct/payrekha) — zero runtime dependencies, ordered cheapest-and-most-decisive first:

`canary.tripped` → `origin.nonprod` → `intent.*` (missing/bad-signature/kind-mismatch/expired/beneficiary-mismatch/reused/amount-exceeds) → `external.verdict`/`external.score` → `settlement.*` → `probe.micro-then-large` → `beneficiary.cooling` → `velocity.outflow` → `amount.band-anomaly` → `feed.reputation` → `client.unattested` → `calendar.window`

```ts
import { payrekhaRules } from '@payrekha/rules';
import { Payrekha } from '@payrekha/core';

const { rules, feed } = payrekhaRules({ velocity: {/* budgets */}, external: { reviewScore: 0.7 } });
const fw = new Payrekha(rules, { config: { mode: 'shadow' } });
```

Tunable per rule via `RulesConfig`; `feed` is the operator-loaded fraud
reputation list. Write your own `PayoutRule` and append — rule errors
degrade to REVIEW, never ALLOW.

Apache-2.0.
