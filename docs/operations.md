# Operations

## Modes

| Mode | What the caller gets | Use it for |
|---|---|---|
| `shadow` (default) | Always `ALLOW`; the real verdict is logged | Weeks 1–2, and any new payout kind |
| `advise` | The real verdict; the caller decides | SDK integrations while tuning |
| `enforce` | `HOLD` for REVIEW, `DECLINE` for BLOCK; ext_authz answers 403 | Production, one kind at a time via `modeByKind` |

Change the mode at runtime with `PUT /v1/state` (admin token, `reason` required). The configuration file stays authoritative: restoring a snapshot never changes the mode.

## API keys and roles

`PAYREKHA_API_KEYS` is `id:prod|nonprod[:role+role]:token` per entry, comma-separated. Without a role list a key can call everything (legacy behaviour). Grant narrowly:

| Role | Allows | Give it to |
|---|---|---|
| `evaluate` | `POST /v1/evaluate` | the payout caller (LMS, payment service) |
| `outcomes` | `POST /v1/outcomes` | whoever reports rail status — see below |
| `intents` | `POST /v1/intents` | the system of record that signs intents (LOS) |
| `mint` | `POST /v1/intents/mint` | managed-intents tier — see `docs/adoption.md` |
| `read` | `GET /v1/state`, `GET /v1/decisions`, `GET /v1/audit`, `GET /v1/intents/{id}`, `GET /metrics` | dashboards, Prometheus, analyst consoles |

m-of-n approvals: `firewall.requiredApprovals` per kind — `{ "VDA_WITHDRAWAL": 2 }` requires the payout's `intentId` plus a distinct-issuer intent in `approvalIds`. `onInsufficient: "review"` holds rather than declines while approvers onboard; `approverIssuers` restricts which issuers count. Approvers register intents through `/v1/intents` or mint like any issuer; every cited intent is consumed per payout and released together on `failed`/`reversed`. See ADR 0003.

`/v1/decisions` serves the last 1000 verdicts from an in-memory ring (newest first; `?verdict=&payoutId=&intentId=&limit=` filters) — the durable record is the decision log/SIEM, this is the triage view. `/v1/audit` serves the last 1000 audit entries the same way. Upstream fraud scores attach to payouts as `riskScore`/`externalVerdict`/`externalSource` — advisory inputs for the `external` rule that can only make verdicts stricter (assert them at the proxy via `extAuthz.mapping` where you can, rather than trusting the body).

```text
PAYREKHA_API_KEYS='lms-prod:prod:evaluate+outcomes:<token>,los:prod:intents:<token>,grafana:prod:read:<token>'
```

A stolen payout key then cannot register intents (which would let it evict live ones from the bounded registry), read state, or free another key's intent.

`POST /v1/outcomes` is bound to the evaluating key: `failed` and `reversed` refund the intent's use, so only the key that evaluated the payout may report on it — every accepted report and every denied attempt is written to the audit trail and the decision log. In the ext_authz path the "key" is the Envoy-asserted `sourceKeyId`; name the reporting API key the same thing.

`settled` is **final and idempotent**: it tombstones the reservation so the payoutId can never be rebound to another intent, and a later `failed`/`reversed` on a settled payout is denied (audited — it signals a broken or hostile reporter). Re-reporting `settled` is safe for retries.

## Caller clocks

`timestampMs` from a client is evidence, not input. The gateway stamps server time and keeps the caller's value as `clientTimestampMs` in the decision record. Set `gateway.trustClientTimestamp` / `extAuthz.trustClientTimestamp` only for a caller whose clock you genuinely trust, and bound it with `firewall.maxTimestampSkewMs`: a claim outside the bound is evaluated at firewall time and the verdict is marked degraded with a `time.skew` hit. The same check guards in-process embedding, where there is no gateway to stamp for you.

## Alert states

- `NORMAL`.
- `HOLIDAY`: set automatically from the calendar (`config/calendars/india-2026.example.json`) and in configured weekend or night windows. Velocity and probe thresholds are multiplied down, for example ×0.5.
- `HIGH_ALERT`: entered on a canary hit, after N BLOCKs in a window (`highAlertOnBlocks`), or by a manual call. Every payout kind then needs an intent and probes block. **It never expires on its own.**

Reset it after you have investigated:

```bash
curl -XPUT localhost:8080/v1/state -H "authorization: Bearer $ADMIN" \
  -d '{"highAlert":"reset","actor":"soc-oncall","reason":"INC-2211 contained, keys rotated"}'
```

Alert on `payrekha_high_alert == 1` (see `deploy/prometheus/alerts.yml`).

While HIGH_ALERT is up, run the incident steps in [runbook.md — incident response](runbook.md#incident-response--reporting-to-cert-in--csirt-fin-and-i4c): preserve the decision log, extract the timeline, rotate the named credentials, and report to CERT-In/CSIRT-Fin and I4C/CFCFRMS as the advisory requires.

## Client fail modes

If PayRekha is unreachable, the client decides using `onUnavailable`:

- `hold-above:5000000` (**default**): hold anything above ₹50,000 and let smaller payouts through.
- `hold`: hold everything. This is the safest option, but an outage of PayRekha becomes an outage of your payouts.
- `allow`: let everything through. Use it only in shadow-mode trials.

Envoy is configured with `failure_mode_allow: false`, which is the same as `hold`. Each client-side fallback verdict is marked `degraded: true` and `unavailable: true`. Log those decisions too.

## State and restarts

The snapshot holds ledgers, velocity windows, intents, dedupe and alert state (hashed refs only). It is saved every `PAYREKHA_STATE_INTERVAL_MS` (default 5 s) and on SIGTERM. The save keeps `exportState()` as the only synchronous step — serialization, HMAC and disk I/O are sliced off the event loop (see `docs/capacity-envelope.md` for the residual-stall bound and `payrekha_state_save_ms` on `/metrics`). Pick one backend:

- `PAYREKHA_STATE_FILE`: a JSON file written atomically with mode `0600`.
- `PAYREKHA_STATE_PG_URL`: Postgres via `@payrekha/store-postgres` (bundled in the image). One row per deployment in `PAYREKHA_STATE_PG_TABLE` (default `payrekha_state`), keyed by `PAYREKHA_STATE_NAME` (default `default`). The table is created on first use.
- `PAYREKHA_STATE_KEY` (recommended): ≥32 chars. Snapshots are stored MAC'd (HMAC-SHA256 over canonical JSON) so tampering with canaries/ledgers/reservations is detected and fails closed at load. Same key for both backends. Once set, legacy unsigned snapshots are refused.
- `PAYREKHA_STATE_KEY_PREVIOUS`: comma-separated retiring keys that still verify during rotation. Sequence: set the new key in `PAYREKHA_STATE_KEY` and the old one in `PAYREKHA_STATE_KEY_PREVIOUS`, restart — the old snapshot loads; after the first save lands under the new key, remove `..._PREVIOUS`. Without the previous key, a rotated primary cannot read its own last snapshot and the service stays unready.
- `PAYREKHA_MINT_KEY_ID` + `PAYREKHA_MINT_KEY` (optional): enables `POST /v1/intents/mint` — the gateway signs intents with this ed25519 key. `keyId` must name an issuer in `issuers[]`; the value is the private key (PKCS#8 base64 or PEM). Boot fails on a mismatched pair. `gateway.mint.defaultTtlMs`/`maxTtlMs` bound intent lifetime (5 min/24 h defaults). Guardrails bound a stolen mint key: `gateway.mint.maxAmountPaise` caps each minted intent's amount, `mintsPerMinute` rate-limits minting per API key (default 60), and `modes` restricts minting to named effective modes (e.g. `["shadow","advise"]` refuses mints while a kind is enforced). Boot warns if an API key holds `mint` alongside `evaluate`/`intents`. This host gains minting power — treat the key accordingly and prefer external signing in enforce mode; see `docs/adoption.md`.

Until the snapshot has been read, `/readyz` and every API call return 503, and the gateway retries every `PAYREKHA_STATE_RETRY_MS` (default 5 s). So an unreachable database or a corrupt file never starts the gateway with an empty memory, and nothing is saved over a snapshot it could not read.

Every Postgres save is a compare-and-set on a version counter. If another instance has written the same row, this instance goes unready with `state written by another instance` instead of overwriting a HIGH_ALERT. That makes the snapshot store good for durability and active/standby failover (the standby loads on start). For active-active replicas, use shared state instead:

### Shared state (ADR 0004, active-active)

With `PAYREKHA_SHARED_PG_URL` set (plus optional `PAYREKHA_SHARED_PG_PREFIX`, default `payrekha_sa`), every replica commits intent consumption through one Postgres transaction before a non-DECLINE verdict leaves — a use can never be double-spent and a payoutId can never bind twice, no matter which replica answers. Three tables are created on first use: `*_intents` (immutable docs + authoritative counters), `*_reservations` (payoutId tombstones + stored verdicts), `*_control` (alert/mode/revocations + generation).

- `gateway.sharedState.commitPolicy`: `'all'` (default) or a list of IntentKinds that must commit — the per-kind consistency/latency knob (e.g. `["VDA_WITHDRAWAL","LOAN_DISBURSAL"]` while REFUND stays local-fast).
- `gateway.sharedState.controlPollMs` (default 2000): control-state convergence poll. The commit checks the control generation inside the transaction, so a revocation or HIGH_ALERT reaches the money path in ~0 ms — the poll only warms the read path.
- `gateway.sharedState.reservationRetentionDays` (unset = keep forever): settled payoutId tombstones older than this are purged hourly, on the database clock. Keep ≥ your payoutId reuse horizon + margin (90 is a sane default); payoutIds should be ULID/date-prefixed so uniqueness is never relied on beyond the window. Pending (unsettled) reservations are never purged.
- Config `gateway.sharedState` without the URL boots on an in-memory backend — single replica only, warned at boot.
- Store unreachable: enforce-mode intent-bound payouts DECLINE (`store.commit-failed` evidence), others degrade; `/readyz` reports not-ready until the poll reconnects. There is no allow-on-outage switch — break-glass is an LB failover to a fenced single active, never a flag.
- Registrations (`POST /v1/intents`, mint), outcomes and admin control ops write through synchronously and return 503 on store failure — retry is idempotent.
- Velocity/cooling/fingerprint heuristics stay per-replica (Phase 1): REVIEW gates, not authorisation counters. Use LB affinity by `sourceKeyId` to keep them coherent.

Rehearse before trusting it: `npm run drill:shared-state` (or `PAYREKHA_SHARED_PG_URL=… node scripts/drill-shared-state.mjs`) drives concurrent spend, payoutId storms, outage and revocation scenarios through two live replicas.

**Cutover from single-node/snapshot to active-active**

1. Freeze schema drift — run the export against the *current* snapshot, not a stale copy.
2. `PAYREKHA_STATE_KEY=… node scripts/state-to-shared.mjs --file <snapshot> --dry-run` — verifies the signature and prints intent/reservation/control counts.
3. `PAYREKHA_SHARED_PG_URL=… node scripts/state-to-shared.mjs --file <snapshot>` — imports intents (GREATEST-merged counters), reservations (first binding wins) and control state (revocations/alert/per-kind modes unioned, `mode` stays config-authoritative). Idempotent — safe to re-run and safe under live single-node traffic; in-flight intents cannot double-spend because imported counters never move backwards.
4. Start the replicas with `gateway.sharedState` set and watch `payrekha_shared_*` metrics (`commits`/`conflicts`/`commit_ms` tell you the commit path is hot and healthy before you cut the LB).

Commit-path observability lives on `/metrics`: `payrekha_shared_commits_total`, `…_committed_total`, `…_conflicts_total{conflict=}`, `…_failclosed_total`, `…_miss_fetches_total`, `…_stale_syncs_total`, `…_purged_reservations_total` and `payrekha_shared_commit_ms_{sum,count,max}`. Alert on `failclosed` growth (store wobble) and `commit_ms` p99 climbing toward your verdict-path latency budget.

## Tuning with replay

1. Replay a month in intent-less mode and read the false-positive list.
2. Give known batch callers their own budget with `velocity.perSourceKeyOverrides` (for example, the nightly settlement run).
3. **`merchantId` is untrusted caller input.** It scopes per-merchant velocity rings and the settlement-account ledger. If a key should only settle for known merchants, pin it with `gateway.merchantScope` — `{"gateway": {"merchantScope": {"pa-key-1": ["merch-a", "merch-b"]}}}` — the gateway then refuses (403) out-of-scope merchantIds and `PA_SETTLEMENT` payouts carrying none. Merchant velocity and key velocity are tracked in separate bounded maps, so churned merchantIds cannot evict either budget.
3. Replay again with intents exported from your LOS. The REVIEW count should fall to the real anomalies.
4. Deploy the same config file in shadow mode and compare its live log with the replay.
