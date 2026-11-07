# ADR 0004 — Shared state: atomic-commit seam for active-active replicas

- Status: proposed
- Date: 2026-11-07

## Context

Today every `Payrekha` instance owns its world in process memory:
intents, reservations, dedupe, HIGH_ALERT, keyring revocations, velocity
rings, cooling ledgers, fingerprint enrolments. `StateStore` (file or
`PostgresStateStore`) persists a *snapshot* — load on boot, save on a
timer. `PostgresStateStore` already states the contract plainly: **one
active writer per `name`**, any number of standbys that `load` on
promotion; a second writer is detected by the version CAS and fails
closed (`StaleStateError`). That is active-passive HA, and it is honest
— promotion means a snapshot-restore gap, and throughput tops out at one
instance.

The next production ask is N replicas behind a load balancer. The
hazards, ranked:

1. **Double consumption — money correctness.** Two replicas `check` a
   `maxUses: 1` intent concurrently, both see `uses: 0`, both `reserve` →
   two payouts allowed against one authorisation. Same payoutId bound on
   two replicas inflates `uses` twice.
2. **Split dedupe.** A retry hitting a different replica finds no
   reservation → `intent.reused` — a false DECLINE for the caller.
3. **HIGH_ALERT / keyring divergence.** An alert raised or an issuer key
   revoked on replica A must reach replicas B…N; a revoked key that still
   verifies elsewhere is a hole.
4. **Heuristic split.** Velocity/cooling budgets stored per-replica give
   an attacker N× the effective budget — detection accuracy, not
   correctness (a missed REVIEW, never a double-spend).

Constraint that shapes everything: the engine and rules are **synchronous
and do no I/O** (ADR 0001). A shared store cannot be queried inside
`evaluate()`; network I/O cannot run on the verdict path.

## Options considered

**A. Leader/follower only.** Keep today's contract; document failover
runbooks. Rejected as the *final* answer — it does not scale and the
standby is cold (restore gap at the worst moment), though it stays a
supported topology forever.

**B. Route-by-key sharding.** Consistent-hash payouts to replicas at the
LB so each beneficiary/key has one evaluator. Rejected as the *correctness*
mechanism: failover re-hashes instantly and in-flight double-spend is back;
fine as a *locality optimisation* on top of atomic commit, not instead of.

**C. Optimistic sync + reconciliation.** Evaluate locally, write behind,
alert on conflict. Rejected: two callers can be told ALLOW against one
`maxUses` intent before the async merge discovers it — the verdict itself
lied. For money, the commit must precede the answer.

**D. Atomic-commit seam — chosen.** Split "read the world" (sync,
in-process, advisory) from "commit the consumption" (one atomic conditional
write, authoritative). `evaluate` stays fully synchronous; only the caller
boundary (`createGateway`, or an opt-in `evaluateAsync` facade) awaits the
commit — and only when a shared backend is configured. Local backend: the
commit is an in-memory CAS, zero cost, today's behaviour.

## Decision

### 1. The commit is the single point of truth

Everything `check()` reads is advisory: intent fields are immutable
post-registration (the signature covers them), so a stale local copy can
only be wrong about `uses`/`usedPaise` — and the commit's conditional
update is the gate that catches it. Invariant:

> An ALLOW for an intent-bound payout is only returned after the
> authoritative store confirms the reservation row was inserted and every
> cited intent consumed its use atomically.

`commitReservation` primitive:

```text
commit(payoutId, intentId, approvalIds[], amountPaise, sourceKeyId, verdict)
→ committed | conflict(payoutId, storedVerdict) | conflict(uses)
```

Postgres: one transaction — `INSERT INTO reservations … ON CONFLICT
(payout_id) DO NOTHING` (a hit means another replica owns this payoutId;
return its stored verdict — the shared dedupe comes free); then per cited
intent `UPDATE intents SET uses=uses+1, used_paise=used_paise+$a WHERE
intent_id=$i AND uses < max_uses AND max_amount_paise-used_paise >= $a`
— any failed rowcount rolls the transaction back → `conflict(uses)` →
caller re-checks → `intent.reused`/`amount-exceeds`, deterministically.
Redis: the same conditionals in one Lua script.

### 2. Reservation conflicts return the stored verdict

Because the reservation row carries `decision_id` + verdict, a cross-
replica retry gets the *original* verdict — dedupe becomes global, not
per-replica. TTL on the row matches `dedupeCapacity` semantics.

### 3. Control-plane state writes through, synchronously

HIGH_ALERT, mode changes, issuer-key revocation, canary edits: rare admin
ops → synchronous CAS write to a shared `control` table (`alert_state`,
`mode`, `keyring_gen`, `canaries_gen`) + append-only `control_audit`.
Replicas poll on a short interval (or LISTEN/notify where available); a
gen bump triggers re-verify/reload. Failure to write = the admin op is
refused, never half-applied.

### 4. Heuristic state stays per-replica in Phase 1

Velocity sums, cooling ledgers, probe memory, fingerprint enrolments,
merchant observations remain local. Rationale: they gate REVIEWs, not the
authorisation itself; sharing them synchronously would put I/O inside the
engine. Accepted limitation: without LB affinity the effective per-key
budgets multiply by replica count — documented, and `deploy/` affinity
guidance (sticky by `sourceKeyId`) ships with the feature. Phase 2
candidates: the same commit piggybacks budget increments, or Redis-side
counters feeding a read-through cache.

### 5. Failure semantics fail closed

Shared store unreachable at commit time: `enforce` → DECLINE + `degraded`
(the money does not move — the brand); `advise` → verdict + degraded;
`shadow` → ALLOW + degraded. `/readyz` reports store reachability.
Registration (`POST /v1/intents`, mint) writes through synchronously —
an unreachable store refuses the write, it does not queue.

### 6. Deployment modes (all stay supported)

| Mode | State | Correctness |
|---|---|---|
| single | memory + FileStateStore snapshot | today, unchanged |
| active-passive | PostgresStateStore snapshot CAS | today, unchanged |
| active-active | shared intents/reservations/dedupe/control | Phase 1 |

Phase 1 backend: Postgres (deploys already have it via `store-postgres`).
Redis adapter implements the same seam; in-memory remains the default.

## Consequences

- `Payrekha.evaluate` untouched — zero I/O in engine/rules preserved.
  The async surface is one new facade method + the gateway's evaluate/
  ext_authz handlers awaiting the commit step.
- `IntentStore` unchanged for reads; a new `ReservationStore`/
  `SharedStateBackend` seam owns commits, control rows and dedupe lookups.
- Snapshot saves remain: heuristics + fast cold-boot, not correctness.
- Ops gain: N replicas, hot standby without restore gap, dedupe that
  survives load-balancer retries.
- Ops cost: one Postgres transaction per intent-bound payout on the
  verdict path (~1 ms LAN); `/readyz` now includes store health.
- Phase-2 backlog: shared heuristic budgets, LISTEN-driven push,
  lease-free failover notes.
