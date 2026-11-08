# Failure-mode matrix

What happens when each dependency fails, what the caller sees, which
metric/alert fires, and which drill or test proves it. Two principles run
through every row: **the verdict path never waits on a side effect**, and
**failures that touch authorisation fail closed — toward DECLINE, never
toward an unauthenticated ALLOW**.

## Edge / availability failures

| Failure | Observed behaviour | Caller sees | Metric / alert | Evidence |
|---|---|---|---|---|
| **Gateway unreachable at the edge** | Envoy `failure_mode_allow: false` (prod `deploy/envoy/envoy.yaml`) → ext_authz errors → request denied at the proxy. Quickstart intentionally ships `true` so a first run never blocks traffic; Kong + nginx recipes default to deny. | `failure_mode_allow:false` → 403 at proxy; `true` → payout proceeds **uninspected** (log the gap — the proxy is outside PayRekha's perimeter) | `payrekha_http_requests_total{status=503}` at the gateway; envoy `ext_authz.error` upstream counter | D2 promotion; gateway e2e `fail closed` tests |
| **Second writer starts** (accidental multi-deploy on one store) | File/`config`-mode state uses CAS fencing — a second writer detects the lease conflict and exits rather than split-brain. | Second instance refuses to serve; first keeps verdicts flowing | Process exit + stderr; `payrekha_ready` drops to 0 on the loser | D3 drill |
| **Standby not promoted** | Standby deployment sits at replicas 0 (Helm). RTO = `kubectl scale` + boot + snapshot load (~seconds). | Outage until promotion; then normal service | `payrekha_ready` gauge on the standby | D2 drill; Helm `standby.enabled` |

## State / authorisation failures

| Failure | Observed behaviour | Caller sees | Metric / alert | Evidence |
|---|---|---|---|---|
| **Shared store (Postgres) down** in active-active | Commit is the only linearisable point: a failed commit → enforce-mode verdicts become `BLOCK`/`DECLINE` with `store.commit-failed`; `/readyz` goes unready; the poll loop re-syncs on recovery. No allow-on-outage switch exists. | `503`/DECLINE on `/v1/evaluate` and ext_authz while the store is unreachable | `payrekha_shared_failclosed_total` rises; `payrekha_ready` = 0; `payrekha_shared_commits_total` stalls | Shared-state e2e (`fail closed + readyz recovery`); D8 drill |
| **Shared store slow** | Every commit adds latency to the verdict path — the commit time *is* the verdict budget. | p99 on `/v1/evaluate` climbs | `payrekha_shared_commit_ms_{sum,count,max}` drift | Load-check Phase C + `commit_ms` alert guidance |
| **Snapshot write fails** (disk full, perms) | Save error is counted; in-memory state keeps serving; the gateway stays ready. Risk is silent — a restart would replay the last *good* snapshot, losing state since it. | Verdicts unaffected while running | `payrekha_state_save_errors_total` > 0 — **alert on this, it is the only signal** | Snapshot save tests; D1 covers the restart half |
| **Restart / kill -9** | Snapshot loads, signature verifies, intents + tombstones restore. Reservations made *after* the last save are gone — a same-`payoutId` retry re-evaluates rather than replaying (safe: a re-evaluation can only re-block or re-allow the same intent, never double-spend past `maxUses` once the commit path is shared). | Brief unready during load | `payrekha_ready` drop → 1 | D1 drill (kill -9 mid-save) |
| **State-save stall** | Since B3, `exportState` is the only synchronous slice; serialization + write are async. A pathological snapshot size shows up as export stall, not a frozen loop. | Verdict latency spike bounded by exportMs | `payrekha_state_save_ms_*` — alert if export half approaches ~250 ms (sharding trigger, see `docs/capacity-envelope.md`) | B3 byte-equivalence + loop-gap tests |

## Side-channel failures (verdict path unaffected)

| Failure | Observed behaviour | Caller sees | Metric / alert | Evidence |
|---|---|---|---|---|
| **Decision-log disk full / write error** | Stream errors are counted; `write()` is fire-and-forget — the verdict never waits on the audit record. Audit gaps are real: investigate the gap window before attesting evidence. | Nothing — verdicts keep flowing | `payrekha_decision_log_errors_total` > 0 | `log.ts` error counter + metrics surface |
| **Webhook receiver down** | Bounded queue + retries with backoff; a full queue drops and counts. `send()` returns before the first byte leaves. | Nothing — SIEM sees silence, which is itself the tell | `payrekha_webhooks_total{result="failed"}` / `{result="dropped"}` | Webhook tests; D7 SIEM drill |
| **Issuer key compromised** | `DELETE /v1/issuers/:keyId` revokes locally, writes the control row; other replicas pick it up on the **next commit** (piggybacked — ~0 ms, not the poll interval). Old key's intents stop verifying immediately. | Signed intents from that key → `key-revoked` verdicts | `payrekha_verdicts_total{verdict=BLOCK}` + `intent.revoked` rule hits | D4 tabletop; shared-state revocation test |
| **Calendar file missing/stale** | `calendar.check` rule degrades to REVIEW (rules never throw through), verdict carries `degraded`. | REVIEW with `degraded: true` | `payrekha_degraded_total`, `payrekha_rule_errors_total` | Rule-error path tests |

## Trust-anchor failures

| Failure | Observed behaviour | Caller sees | Metric / alert | Evidence |
|---|---|---|---|---|
| **Clock skew** (payout source vs intent minter) | `payout.timestampMs` must sit inside `[notBeforeMs, expiresAtMs]` — a skewed producer mints payouts that read as `expired`. Fails closed: skew can cause false *declines*, never allows outside the window. Signing-key `notAfterMs` is checked against `atMs` at verify time → `key-expired`. | `expired` / `key-expired` verdicts | `payrekha_verdicts_total` + `payrekha_rule_hits_total{rule="intent.expired"}` | Registry expiry tests |
| **Keyring empty / unknown key** | `verify` returns `unknown-key` → intent registration is rejected; unsigned payouts fall through to `requireIntent` policy per kind (deny where required). A managed-mint boot with a `PAYREKHA_MINT_KEY` that doesn't verify against the configured issuer **fails startup** — the keyring probe runs at boot, not first mint. | Registration 4xx; intent-less payouts per per-kind policy | `payrekha_evaluations_total` with `intent.unsigned`/`intent.unregistered` hits | Boot-probe tests; `unknown-key` vector |
| **Intent replayed / replayed late** | Same `intentId` + same payout → tombstone replays the stored verdict with `deduped: true`; cross-replica replays hit the shared store's stored-verdict path. Uses are atomic at commit. | Identical verdict + `deduped` | `payrekha_deduped_total` | Dedupe + stored-verdict e2e |

## What is *not* covered — by design

These are real failure modes that belong to the operator's perimeter, not
PayRekha's process: the **edge proxy's own failure** (envoy down → whatever
its `failure_mode` says — PayRekha cannot force a closed proxy open or an
open one closed), **Postgres corruption** (backups/restore are your runbook —
`state-to-shared.mjs` re-imports a signed snapshot), and **host compromise**
(threat model §hardening: PayRekha assumes the host is not attacker-root;
keys are files, HSM/KMS removes even that — `docs/kms.md`).

Reading the matrix the other way: every `payrekha_*_errors_total` and
`*_failclosed_total` counter is an alert candidate; nothing on this page
fails silently.
