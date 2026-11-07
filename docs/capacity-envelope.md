# Capacity envelope (B3)

Measured on an Apple-silicon dev host (single process, `Payrekha.evaluate`
in-process + rules pack minus band rules, `enforce` mode). Reproduce with:

```bash
npm run build && node scripts/load-check.mjs \
  --intents 20000 --beneficiaries 50000 --merchants 5000 --seconds 8 --json
```

**Re-run on production-class hardware before setting thresholds** — these
numbers bound the shape of the envelope, not your machine's exact point on it.

## Evaluation throughput vs state size

| State | eval rps | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| 20k intents · 50k beneficiaries · 5k merchants | ~125k/s | 9 µs | 26 µs | 32 µs | 7.4 ms |
| 100k intents · 200k beneficiaries · 20k merchants | ~108k/s | 9 µs | 28 µs | 34 µs | 9.6 ms |

`evaluate()` is effectively flat against state size — rules touch bounded
ledgers (`LruMap`/`TimeRing`), not the full set. The p99 is two orders of
magnitude under the 5 ms budget; the max is a GC/alloc outlier, not a rule.

## Snapshot save — what actually blocks the event loop

`exportState()` is deliberately synchronous: the snapshot must be one
instant's consistent view (a torn export could resurrect a spent intent's
free use — that direction is unsafe, the other direction is a false
decline). Everything *after* export — canonical serialization, the HMAC,
the file write — is immutable work, so `serializeSnapshot` slices it into
~2 ms event-loop yields (`yieldEvery` leaf steps, default 2048).

| Snapshot size | `exportState` (sync stall) | serialize wall (off-loop) | worst loop gap during serialize |
|---|---|---|---|
| ~12 MB (20k intents / 50k bens) | ~6 ms | ~82 ms | ~5 ms |
| ~56 MB (100k intents / 200k bens) | ~60 ms | ~340 ms | ~8 ms |

Before B3 the stall was `export + canonicalJson + JSON.stringify +
writeFileSync` as one blocking run (~4–6× the export number above). Now the
residual sync pause is `exportState` alone — roughly **1 µs per MB of
snapshot per 1k rows**, linear. Watch it on `/metrics`:
`payrekha_state_save_ms_{sum,count,max}` (includes serialize+write wall),
`payrekha_state_save_errors_total`.

### Tuning the residual stall

- `PAYREKHA_STATE_INTERVAL_MS` (default 5000): how often saves happen. A
  60 ms export stall every 5 s = ~1.2% duty; every 30 s = ~0.2%. Stretch it
  before you shard anything.
- State size follows tracked entities: beneficiaries/merchants/reservations
  are `LruMap`-bounded; intents are unbounded by design (they're contracts —
  expiry is a correctness property, not storage pressure). Retention sweeps
  (`reservationRetentionDays`) bound the shared table; the local reservation
  LRU bounds the file snapshot.
- If `exportMs` ever approaches ~250 ms the plan is **sharding, not
  weakening the consistency anchor**: split the snapshot into
  per-section exports each taken at its own instant — tearing *between*
  sections is safe only when reservation rows are exported **before** the
  intent counters they consume (a tear then yields a false decline, never
  a double-spend). Not implemented — flagged in
  `docs/production-readiness-plan.md`.

## Memory

| State | heap after seed | heap after 8 s run |
|---|---|---|
| 20k intents · 50k bens | ~73 MB | ~124 MB |
| 100k intents · 200k bens | ~131 MB | ~613 MB |

Post-run heap is dominated by the dedupe cache + ledgers for distinct
traffic seen during the run — both `LruMap`-bounded (capacity ~1M rows).
Size pods by the *seed* heap + dedupe/ledger headroom, not the snapshot file.

## What this is not

- Numbers are **eval-path** only. The `/v1/evaluate` HTTP path adds
  auth+body-parse+decision-log (~tens of µs) per call; measure end-to-end on
  your deployment with `scripts/verify-deploy.mjs`.
- Under active-active (ADR 0004), add one Postgres commit per intent-bound
  payout — budget `payrekha_shared_commit_ms` (p99 on `/metrics`), not the
  numbers here.
