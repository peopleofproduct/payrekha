# Payrekha

**The Lakshman Rekha for money leaving your systems.**
No matching intent, no payout — whoever is calling your API.

[![CI](https://github.com/peopleofproduct/payrekha/actions/workflows/ci.yml/badge.svg)](https://github.com/peopleofproduct/payrekha/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node ≥ 22](https://img.shields.io/badge/node-%E2%89%A522-339933)](package.json)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange)](CHANGELOG.md)
[![Maintained by People of Product™](https://img.shields.io/badge/maintained%20by-People%20of%20Product%E2%84%A2-1b1b1f)](https://github.com/peopleofproduct)

Payrekha (*payout + rekha*, the line you do not cross) is an open-source, in-process **payout firewall** for Indian NBFCs, digital lenders, payment aggregators and crypto exchanges. It checks every rupee your *own* systems send out. A payout is allowed only if it matches a real business intent: a sanctioned loan, a reconciled settlement or a whitelisted withdrawal. It does not matter which API, credential or app made the call.

| | |
|---|---|
| **What it is** | A TypeScript library and a small HTTP gateway (with an Envoy ext_authz adapter) that answers `ALLOW`, `REVIEW` or `BLOCK` for each payout. Measured p99 is about 19 µs in-process and 0.7 ms through the gateway on a laptop. |
| **Who it's for** | Teams that run payout, disbursal, refund, settlement or withdrawal APIs, and the CISOs who answer for them. |
| **What it is not** | Not an ML platform, not an EDR, and not a replacement for patching or cloud audit logs. It is the last check before the money leaves. |
| **Maturity** | **Alpha** (`0.1.0-alpha.0`). Thresholds are illustrative and have not been tuned on production data. Run it in shadow mode first. |

## In plain words

CERT-In advisory CIAD-2026-0058 describes "CRAFTY FALCON": attackers get inside a lender or payment company and then **call the victim's own payout APIs**. They do ₹1 test transfers before large ones. They abuse merchant settlement APIs. They move from an exposed UAT box into production, call APIs directly from repackaged mobile apps, and strike on holidays. Every one of those calls uses a valid credential. Perimeter controls do not see a problem.

Payrekha adds a second key. The system that *decides* money should move (your LOS, your reconciliation engine, your withdrawal approver) signs an **intent**: this loan, this amount ceiling, this beneficiary, valid until this time. The system that *moves* money must show a matching intent. If an attacker steals the payout credential, they still do not have the intent-signing key. **Even if they're inside, the money doesn't leave.**

## Where it sits

```mermaid
flowchart LR
  LOS[LOS / settlement engine<br/>system of record] -- signed intent --> PR
  App[LMS, ops tools, scripts,<br/>or an attacker with a stolen key] -- payout call --> GW[Envoy / your payout service]
  GW -- ext_authz or SDK --> PR[Payrekha<br/>intents + rules]
  PR -- ALLOW / REVIEW / BLOCK --> GW
  GW -- only if ALLOW --> Bank[(Bank / NPCI rails)]
  PR -- JSONL / CEF --> SIEM[SIEM]
  PR -- signed webhook --> SOAR[SOAR]
```

## See it work in 10 seconds

```bash
npm ci && npm run demo            # the CRAFTY FALCON chain against a fake NBFC
npm run demo -- --shadow          # the same run in shadow mode: nothing stopped, everything logged
npm run demo -- --json            # one JSON line per step
npm run demo:live                 # live, through Envoy (start the compose stack first)
```

The demo walks through these steps: a legitimate penny-drop and loan disbursal, then stolen credentials with no intent, a replayed intent, a ₹1 then ₹4,99,999 probe, a UAT key, a changed settlement account, a Diwali burst, and a canary hit that enters `HIGH_ALERT`. It ends with *"8 attack steps. ₹0 left the building."*

## Try it on your own data, with no integration

```bash
npm run replay -- --payouts examples/data/payouts.csv --intents examples/data/intents.csv --config examples/data/payrekha.json
npm run replay -- --payouts your-ledger-export.csv     # intent-less mode: Day 1, no production change
```

This writes a terminal summary, a self-contained `report.html` and `report.json`. See [getting started](docs/getting-started.md).

## Run it as a service in 30 seconds

```bash
docker compose -f deploy/docker-compose.yml up --build
# Envoy :10000 guards a fake /payouts API · Payrekha :8080 · Prometheus :9090
curl -i -XPOST localhost:10000/payouts -H 'x-payout-kind: LOAN_DISBURSAL' \
  -d '{"request_id":"r1","amount_in_paise":24000000,"beneficiary":{"account_number":"000123456789","ifsc":"HDFC0001234"}}'
# shadow (default): 200, and the BLOCK is logged · after PUT /v1/state {"mode":"enforce"}: 403 + x-payrekha-rules: intent.missing
```

## How a verdict is produced

1. **Shape check.** Malformed, missing or unparseable input becomes `REVIEW` with `degraded: true`. It is never a silent `ALLOW`.
2. **Retry dedupe.** The same `payoutId` gets the same answer.
3. **Rules in order.** Canaries and origin come first, then the intent binding, then behaviour. The first `BLOCK` short-circuits; otherwise the worst verdict wins. A rule that throws is isolated in `ruleErrors` and the verdict is marked degraded.
4. **Mode.** `shadow` (default) always lets the payout through and logs. `advise` tells the caller. `enforce` holds or declines. The mode can be set per payout kind.
5. **Alert state.** `NORMAL` changes to `HOLIDAY` automatically from the calendar, which tightens thresholds. A canary hit or a burst of blocks raises `HIGH_ALERT`, and every payout then needs an intent. **HIGH_ALERT never expires on its own.** Only an authenticated admin can reset it.

Every hit carries a rule ID, a plain-words reason with ₹ amounts, and structured evidence. Beneficiaries are keyed hashes (`hb1_…`) from the moment they enter. Raw account numbers, VPAs and mobiles never reach logs or state.

| Rule | Fires when | Default |
|---|---|---|
| [`intent.missing`](docs/rules/intent.missing.md) | No intent on a payout kind that requires one | BLOCK |
| [`intent.bad-signature`](docs/rules/intent.bad-signature.md) | Signature invalid, or the key is unknown or revoked | BLOCK |
| [`intent.kind-mismatch`](docs/rules/intent.kind-mismatch.md) | A refund intent is used for a disbursal, and similar | BLOCK |
| [`intent.expired`](docs/rules/intent.expired.md) | Outside the intent's validity window | BLOCK |
| [`intent.amount-exceeds`](docs/rules/intent.amount-exceeds.md) | Above the intent's ceiling | BLOCK |
| [`intent.beneficiary-mismatch`](docs/rules/intent.beneficiary-mismatch.md) | A real intent replayed to another account | BLOCK |
| [`intent.reused`](docs/rules/intent.reused.md) | Intent used more than `maxUses` times | BLOCK |
| [`settlement.over-captured`](docs/rules/settlement.over-captured.md) | Settlement above the reconciled amount | BLOCK |
| [`settlement.account-changed`](docs/rules/settlement.account-changed.md) | Merchant settlement account changed recently | REVIEW |
| [`probe.micro-then-large`](docs/rules/probe.micro-then-large.md) | ₹1 test, then a large payout (penny-drop aware) | REVIEW (BLOCK in HIGH_ALERT) |
| [`beneficiary.cooling`](docs/rules/beneficiary.cooling.md) | Large payout to a beneficiary first seen minutes ago | REVIEW |
| [`velocity.outflow`](docs/rules/velocity.outflow.md) | Outflow over budget per API key, merchant or globally | REVIEW, BLOCK above 2× |
| [`amount.band-anomaly`](docs/rules/amount.band-anomaly.md) | Far above the rolling median/MAD band | REVIEW |
| [`origin.nonprod`](docs/rules/origin.nonprod.md) | Call from a UAT or staging origin or key | BLOCK |
| [`canary.tripped`](docs/rules/canary.tripped.md) | Planted canary beneficiary, key or intent touched | BLOCK + HIGH_ALERT |
| [`calendar.window`](docs/rules/calendar.window.md) | Holiday, weekend or night window (evidence only) | ALLOW (tightens others) |
| [`feed.reputation`](docs/rules/feed.reputation.md) | Beneficiary is on an operator-loaded fraud feed | REVIEW / BLOCK |
| [`client.unattested`](docs/rules/client.unattested.md) | App attestation is required but missing | REVIEW |

## Repository layout

```
packages/core      engine, intents (Ed25519/HMAC), keyed hashing, ledgers, modes, alert states, file store
packages/rules     the v0.1 rule set (zero runtime deps, no network)
packages/store-postgres  Postgres state store (compare-and-set, fails closed on a second writer)
packages/gateway   HTTP API, Envoy ext_authz adapter, JSONL/CEF log, Prometheus metrics, signed webhooks
packages/replay    CSV/JSON replay with terminal, HTML and JSON reports
clients/java       Java 11+ client (java.net.http); Ed25519 intent signing on JDK 15+
clients/python     stdlib client and intent signing (Ed25519 via optional `cryptography`)
deploy             Dockerfile (non-root, read-only), Envoy compose stack, Prometheus alerts
examples           demo, reference gateway, synthetic month of NBFC payouts
docs               getting started, intents, penny-drop, threat model, operations, advisory mapping, rules
```

## Design guardrails, and what we measure

- Shadow is the default. Blocking needs an explicit `mode: enforce`.
- Amounts are integer paise. A float amount is rejected, never rounded.
- Times are epoch ms with IST calendar logic.
- Core and rules have zero runtime dependencies and make no network calls. CI checks both.
- State is bounded (LRU maps, ring buffers). Snapshots are written atomically with mode `0600`. Restoring a snapshot never changes the configured mode.
- `npm run bench` on Node 24 (laptop): in-process p50 10 µs, p99 19 µs; gateway p99 0.73 ms over loopback. CI fails on a large regression.

## What Payrekha does not do (yet)

There is no UI console (an operations console is planned), no ML, and no hosted service. It makes no calls to government or third-party APIs. A Go client and a shared store for active-active replicas are coming. See [ROADMAP](ROADMAP.md) and the honest [advisory mapping](docs/advisory-mapping.md#what-payrekha-does-not-cover).

## Documentation

- [Getting started](docs/getting-started.md): replay, then shadow via Envoy, then advise, then enforce
- [Intents](docs/intents.md): the model, signing, key rotation, and "two keys to move money"
- [Penny-drop](docs/penny-drop.md): why naive ₹1 rules fail at lenders
- [Threat model](docs/threat-model.md) · [Operations](docs/operations.md) · [Advisory mapping](docs/advisory-mapping.md)
- Integrations: [Envoy](docs/integrations/envoy.md) · [Java/Spring](docs/integrations/java-spring.md) · [Python](docs/integrations/python.md) · [Node](docs/integrations/node.md) · [SIEM](docs/integrations/siem.md) · [Kubernetes](docs/integrations/kubernetes.md)
- [API contract](docs/api/openapi.yaml) · [ADR 0001: engine](docs/adr/0001-engine.md) · [Repository settings](docs/repository-settings.md)

## Family

- [Krediwall](https://github.com/peopleofproduct/krediwall): the in-process fraud firewall for credit-funded UPI payments. Payrekha's engine semantics come from it.
- [Panini](https://github.com/peopleofproduct/Panini): People of Product's open-source work for India's digital public infrastructure.

## Project

[Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Security policy](SECURITY.md) · [Trademarks](TRADEMARKS.md) · [NOTICE](NOTICE)

## License

Apache-2.0. See [LICENSE](LICENSE). Copyright 2026 Kapil. Maintained by [People of Product](https://github.com/peopleofproduct)™. The Apache licence grants no trademark rights; see [TRADEMARKS.md](TRADEMARKS.md).
