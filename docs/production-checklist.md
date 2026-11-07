# Production checklist

What must be true before PayRekha sits on a real payout path. Work top to bottom; a box unchecked means the launch posture changes, not that the item is optional.

## Deployment

- [ ] Topology chosen: single active writer (`replicaCount: 1` or manually-promoted standby — a second writer is fenced, not merged), or **active-active via `PAYREKHA_SHARED_PG_URL`** where replicas share the `payrekha_sa_*` tables. For active-active: `gateway.sharedState.commitPolicy` decided per kind, `drill-shared-state` run green against the real backend, LB affinity by `sourceKeyId` configured (per-replica heuristics stay local in Phase 1), `reservationRetentionDays` set ≥ payoutId reuse horizon, and `scripts/state-to-shared.mjs` run at cutover (dry-run first) so existing intents/reservations import cleanly.
- [ ] If deploying via `deploy/helm/payrekha`: `topology` matches the choice above (`standby.enabled` for manual fast-promotion on single), `networkPolicy.postgresTo` set for Postgres backends, `serviceMonitor` + `bearerTokenSecret` wired, `priorityClassName` decided, PDB verified against upgrade policy.
- [ ] State backend chosen and tested: `PAYREKHA_STATE_FILE` on a PVC that survives pod restart, or `PAYREKHA_STATE_PG_URL`. Restore verified once with a real snapshot (`kill -9` → cold start → HIGH_ALERT and intents intact, `/readyz` 503 until loaded).
- [ ] `PAYREKHA_DECISION_LOG` on a persistent, rotated, shipped volume — it is the audit trail, including `type:"audit"` records for admin actions and outcome reports.
- [ ] Secrets in a Secret store, never in `values.yaml` or the image: `PAYREKHA_API_KEYS`, `PAYREKHA_ADMIN_KEY`, `PAYREKHA_HASH_KEY`, issuer secrets. Admin token ≥ 32 chars in a vault, access logged.
- [ ] `PAYREKHA_API_KEYS` role-scoped: payout caller `evaluate`(+`outcomes` if it reports rail status), LOS `intents`, monitoring `read`. No roleless keys in production.
- [ ] **Separate API keys per environment.** `origin` binds the key's environment, not the caller's network segment — a key id shared between UAT and prod is invisible to `origin.nonprod`. Give every environment its own key id and mark it `prod` or `nonprod` accordingly.
- [ ] Optionally pin each caller's expected environment: `rules.origin.keyOrigins` (`sourceKeyId → 'prod'|'nonprod'`) emits `origin.mismatch` REVIEW evidence on any disagreement — catches drift between `PAYREKHA_API_KEYS` and Envoy route config.
- [ ] `firewall.maxTimestampSkewMs` set (e.g. 300000) — flags client-clock anomalies as `time.skew`.
- [ ] `gateway.trustClientTimestamp` unset/false unless the caller's clock is genuinely trusted.

## Path

- [ ] Envoy `failure_mode_allow` decided deliberately: `false` (PayRekha down = payouts held — preferred for enforce) or `true` (payrolls continue while PayRekha is down — a documented gap, acceptable only for early shadow trials).
- [ ] `sourceKeyId` is asserted by Envoy (`headers_to_add` / auth-derived), never forwarded from the client.
- [ ] Every payout kind is reachable only through a checked path — no route around the filter.
- [ ] `highAlertOnBlocks` and mode are set per kind via `modeByKind` where needed; `enforce` is never the global default on day one.

## Observability & response

- [ ] Prometheus scraping `/metrics` (key with `read` role); the shipped alerts in `deploy/prometheus/alerts.yml` wired to paging: `PayrekhaNotReady`, `PayrekhaStateSaveErrors`, `PayrekhaHighAlert` are critical.
- [ ] Decision log reaching the SIEM; someone owns the `outcome.denied` and `time.skew` signals.
- [ ] Runbooks agreed for: HIGH_ALERT reset (who, what evidence, `PUT /v1/state` with reason), issuer-key compromise (revoke + re-register flow), standby promotion after writer fencing.
- [ ] Drills run at least once with results logged (`docs/drills.md`): `npm run drill:crash` locally; `npm run drill:shared-state` when active-active is enabled; D2–D7 on the real deployment before enforce. Alert on `payrekha_shared_failclosed_total` growth and `payrekha_shared_commit_ms` latency drift when active-active is enabled.
- [ ] `npm run loadcheck` re-run on production-class hardware; numbers compared against `docs/capacity-envelope.md` (serialization is already sliced off the event loop — watch `exportMs` and `payrekha_state_save_ms_max`; escalate to per-section snapshot sharding only if export alone approaches ~250 ms).
- [ ] Rollback verified: redeploy previous image, state file still readable by it.

## Verdict safety

- [ ] **Mode is `shadow` on day one.** Thresholds are illustrative and untuned — `enforce` before replaying real traffic turns false positives into declined payouts.
- [ ] Replay of ≥1 month of production payout history done (`npm run replay`), false-positive list reviewed, `velocity.perSourceKeyOverrides` set for known batch callers.
- [ ] Graduation criteria agreed before launch: N days shadow, FP rate < X%, then `advise` per kind, then `enforce` per kind.

## Known limitations accepted

- Heuristic state (velocity/cooling/fingerprint) is per-replica even under active-active — REVIEW gates only, mitigation is LB affinity; shared heuristic budgets are a Phase-2 item.
- Up to `PAYREKHA_STATE_INTERVAL_MS` of state can be lost on hard crash.
- Thresholds unvalidated on production data until the shadow trial completes.
