# Upgrades, snapshot versions & DR discipline (B6)

## Snapshot schema-version contract

`FirewallSnapshot.version` is currently **`1`** (`firewall.ts:133`). The
contract, stated before the first bump so it's a commitment not a retrofit:

- A version bump **always ships a migration in code** — a `migrate1to2`-style
  adapter that turns a v1 snapshot into v2 in memory at load. Migrations
  are never a manual runbook step; an operator running N+1 on a v1 file
  gets a clean import or a loud boot failure, never silent mis-state.
- `restoreState` rejects unknown versions with a clear error — a snapshot
  from a *newer* release fails closed (downgrade path is the rollback
  drill below, not blind restore).
- Signed snapshots verify **before** migration — HMAC over stored bytes;
  a tampered file fails `verifyAndUnwrap` regardless of version.
- The same contract covers the **shared-state schema** (Postgres tables) —
  DDL changes ship as numbered migrations applied by
  `store-postgres` at boot or by an explicit migrate step, never by hand.
- Version-bump checklist (for maintainers): bump constant → add adapter →
  test restores **across the boundary** (v_old file → new binary) →
  note in the release notes' upgrade section.

## RPO / RTO per state backend

| Backend | RPO (state loss on crash) | RTO (back to serving) | Notes |
|---|---|---|---|
| `config`-only / memory | Snapshot interval (`PAYREKHA_STATE_INTERVAL_MS`, default 5 s) — reservations/intent-uses since last save re-evaluate; intents themselves restore | Process restart + snapshot load (seconds for ≤ ~50 MB) | Reservations lost post-save are safe — a retry re-evaluates rather than replaying a stale verdict |
| File snapshot + standby | Same as above + the file must be reachable by the standby (shared volume or object-store copy is your infra) | D2 promotion drill ≈ `kubectl scale` + boot + load — tens of seconds | Standby at replicas 0 by design — a live second writer CAS-fences |
| Postgres shared (active-active) | Reservations/intent-uses: **≈ commit-time** (they're written at verdict, not at snapshot); heuristic/feed state: snapshot interval; Postgres itself: your PITR/replication | Surviving replicas keep serving — a PG outage fails closed, not down (failure-modes.md) | Commit metrics expose write latency; `commit_ms` drift is the leading indicator |

## Rolling upgrade + verified rollback — procedure

**Pre-flight**: snapshot exists and verifies (`PAYREKHA_STATE_HMAC_KEY`
set — an unsigned snapshot is a weaker restore); decision log shipped to
SIEM; a known-good payoutId you can re-send as a canary check.

**Upgrade**:
1. Single/standby: upgrade the standby image first, run it against the
   existing snapshot, verify `/readyz` and a shadow evaluate, then
   promote — then swap the primary. The standby *is* the canary.
2. Active-active: `RollingUpdate{maxSurge:1, maxUnavailable:0}` — new
   replicas join behind the shared store; the PDB guarantees ≥1 serving
   replica throughout. Watch `payrekha_shared_commits_total` continue
   through the rollout.
3. Verify: `payrekha_ready`, a probe evaluate, decision log still
   appending, intents intact (`/v1/intents` count vs pre-upgrade).

**Rollback** (the part most DR plans never test):
1. Pin back to the previous image — for single/standby, demote then swap;
   for active-active, `kubectl rollout undo`.
2. If the new version wrote a *newer-format* snapshot, restore from the
   **pre-upgrade snapshot copy** (keep one per upgrade — the drill below
   makes this a habit, not a hope).
3. Verify the same probes; diff `/v1/intents` count and
   `payrekha_deduped_total` behaviour against expectation.

**What must never happen**: skipping the pre-upgrade snapshot copy —
a v2-written file can't feed a v1 binary. One copy per upgrade is cheap
insurance.
