# ADR 0001 — A generic engine with Krediwall's semantics

- Status: accepted
- Date: 2026-11-05

## Context

PayRekha is a sibling of [Krediwall](https://github.com/peopleofproduct/krediwall). Both get a request, run an ordered list of deterministic rules, and return a verdict with evidence. The obvious choice was to depend on `@krediwall/core` and write PayRekha's rules against it.

We read `@krediwall/core` (`packages/core/src/engine.ts`, `types.ts`) before deciding:

- `Rule.evaluate(txn: Transaction)` takes Krediwall's UPI `Transaction` type (payer/payee VPA, MCC, device and so on). The shape check in `FirewallEngine.evaluate` is written for that type too.
- The package is published as CommonJS. PayRekha is ESM-only.
- The rule interface has no context argument. PayRekha rules need the intent check, the alert state, the calendar window and the ledger entries for each payout, and the engine has to supply them. Rules must not reach into global state for them.

Using `@krediwall/core` would mean either forcing payouts into a UPI `Transaction` shape, or changing Krediwall. The build brief says Krediwall must not be modified.

## Decision

`@payrekha/core` has its own small engine, `Engine<Req, Ctx>` (`packages/core/src/engine.ts`, about 150 lines). It is generic over the request and context types, and it copies Krediwall's evaluation semantics exactly:

| Semantic | Krediwall | PayRekha |
|---|---|---|
| Shape check first; malformed input becomes `REVIEW` with `degraded: true` and no rules run | yes | yes (`validate` option) |
| Rules run in a fixed order | yes | yes |
| A rule that throws is recorded in `ruleErrors[]`, the evaluation is marked degraded, and the error is never re-thrown | yes | yes |
| Verdict is the worst severity among hits (`ALLOW < REVIEW < BLOCK`) | yes | yes |
| The first `BLOCK` short-circuits the remaining rules | yes | yes |
| `elapsedMicros` per evaluation, plus latency buckets | yes | yes |
| Rule state can be exported/restored, and hot-swapping carries state between rules with the same name | yes | yes |
| Retry dedupe window | engine | `Payrekha` facade (keyed by `payoutId`) |

Payout-specific behaviour (intents, modes, alert states, ledgers) is in the `Payrekha` facade (`firewall.ts`), not the engine.

The engine semantics are attributed to `@krediwall/core` in `NOTICE` (Apache-2.0, same copyright holder).

## Consequences

- PayRekha has zero runtime dependencies and is ESM-only, as the brief requires.
- The same semantics now exist in two codebases. A behaviour change in one has to be copied to the other by hand until the two converge.
- Rule IDs, evidence shape and the decision-log fields match the family style, so a Krediwall operator can read PayRekha's output straight away.

## Convergence plan

1. Pull `Engine<Req, Ctx>` into a shared package (working name `@peopleofproduct/rule-engine`): ESM, zero dependencies, with PayRekha's tests as the contract.
2. Krediwall adopts it behind its existing `FirewallEngine` API (`Engine<Transaction, void>` plus its own dedupe), and publishes a dual ESM/CJS build so its current users are not broken.
3. PayRekha moves to the shared package. Its public API does not change.

We do this only once both projects have external users who would benefit. Until then, parity is checked by the shared test cases in `packages/core/test/core.test.ts` (`Engine (Krediwall semantics)`).
