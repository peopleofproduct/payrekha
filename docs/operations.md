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
| `read` | `GET /v1/state`, `GET /metrics` | dashboards, Prometheus |

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

## Client fail modes

If Payrekha is unreachable, the client decides using `onUnavailable`:

- `hold-above:5000000` (**default**): hold anything above ₹50,000 and let smaller payouts through.
- `hold`: hold everything. This is the safest option, but an outage of Payrekha becomes an outage of your payouts.
- `allow`: let everything through. Use it only in shadow-mode trials.

Envoy is configured with `failure_mode_allow: false`, which is the same as `hold`. Each client-side fallback verdict is marked `degraded: true` and `unavailable: true`. Log those decisions too.

## State and restarts

The snapshot holds ledgers, velocity windows, intents, dedupe and alert state (hashed refs only). It is saved every `PAYREKHA_STATE_INTERVAL_MS` (default 5 s) and on SIGTERM. Pick one backend:

- `PAYREKHA_STATE_FILE`: a JSON file written atomically with mode `0600`.
- `PAYREKHA_STATE_PG_URL`: Postgres via `@payrekha/store-postgres` (bundled in the image). One row per deployment in `PAYREKHA_STATE_PG_TABLE` (default `payrekha_state`), keyed by `PAYREKHA_STATE_NAME` (default `default`). The table is created on first use.
- `PAYREKHA_STATE_KEY` (recommended): ≥32 chars. Snapshots are stored MAC'd (HMAC-SHA256 over canonical JSON) so tampering with canaries/ledgers/reservations is detected and fails closed at load. Same key for both backends. Once set, legacy unsigned snapshots are refused.
- `PAYREKHA_STATE_KEY_PREVIOUS`: comma-separated retiring keys that still verify during rotation. Sequence: set the new key in `PAYREKHA_STATE_KEY` and the old one in `PAYREKHA_STATE_KEY_PREVIOUS`, restart — the old snapshot loads; after the first save lands under the new key, remove `..._PREVIOUS`. Without the previous key, a rotated primary cannot read its own last snapshot and the service stays unready.

Until the snapshot has been read, `/readyz` and every API call return 503, and the gateway retries every `PAYREKHA_STATE_RETRY_MS` (default 5 s). So an unreachable database or a corrupt file never starts the gateway with an empty memory, and nothing is saved over a snapshot it could not read.

Every Postgres save is a compare-and-set on a version counter. If another instance has written the same row, this instance goes unready with `state written by another instance` instead of overwriting a HIGH_ALERT. That makes Postgres good for durability and active/standby failover (the standby loads on start), not for active-active: run one active replica per `PAYREKHA_STATE_NAME`. A shared store for active-active velocity windows is on the [ROADMAP](../ROADMAP.md).

## Tuning with replay

1. Replay a month in intent-less mode and read the false-positive list.
2. Give known batch callers their own budget with `velocity.perSourceKeyOverrides` (for example, the nightly settlement run).
3. Replay again with intents exported from your LOS. The REVIEW count should fall to the real anomalies.
4. Deploy the same config file in shadow mode and compare its live log with the replay.
