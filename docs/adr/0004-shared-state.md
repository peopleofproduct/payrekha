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

Two properties fall out of that shape and are load-bearing:

- **Idempotent commit.** A retried commit for the same `payoutId` hits the
  `ON CONFLICT` path and returns the stored verdict — the network can be
  flapped at will without a second consumption.
- **Granular opt-in.** `commitPolicy: 'all' | IntentKind[] | 'none'` lets a
  lender put the authoritative commit only on the kinds that need it
  (`VDA_WITHDRAWAL`, `LOAN_DISBURSAL`) while low-value kinds stay
  local-fast. Same knob philosophy as `requiredApprovals`/`modeByKind` —
  each team sets its own blast radius vs latency trade.

On `conflict(uses)` or a store error the replica drops the affected intent
from its read cache and re-checks; on **reconnect after an outage it
re-syncs `uses` wholesale** — remote commits landed while it was away.

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
per-replica. Tombstone retention is bounded (`retentionDays`, e.g. 90):
settled rows older than the window export to the audit store and purge —
a forever-growing table is a liability at PA scale, and `payoutId`
guidance (ULID/date-prefixed) means uniqueness is never relied on beyond
it. TTL/retention decisions run on the **store's clock**, never node
time — replicas skew.

### 3. Control-plane state writes through — and rides the commit

HIGH_ALERT, mode changes, issuer-key revocation, canary edits: rare admin
ops → synchronous CAS write to a shared `control` table (`alert_state`,
`mode`, `keyring_gen`, `canaries_gen`) + append-only `control_audit`.
Propagation is two-layered:

- **The money path is instant.** Every `commitReservation` reads the
  control generation in the *same transaction* — a `keyring_gen` or
  `alert_state` bump returns `conflict(control)`, the replica refreshes
  and re-evaluates. Revocation-to-stop latency on the authorize path is
  ~0 ms, not the poll interval. This is what closes the real race: a
  stolen issuer key sprinting across replicas during a propagation gap.
- **Cache warming pushes.** LISTEN/NOTIFY where the backend has it, else
  a short poll — keeps the read-through cache fresh for the fields that
  never reach the verdict path.

Failure to write = the admin op is refused, never half-applied.

### 4. Heuristic state stays per-replica in Phase 1

Velocity sums, cooling ledgers, probe memory, fingerprint enrolments,
merchant observations remain local. Rationale: they gate REVIEWs, not the
authorisation itself; sharing them synchronously would put I/O inside the
engine. Accepted limitation: without LB affinity the effective per-key
budgets multiply by replica count — documented, and `deploy/` affinity
guidance (sticky by `sourceKeyId`) ships with the feature. Phase 2
candidates: the same commit piggybacks budget increments, or Redis-side
counters feeding a read-through cache.

### 5. Failure semantics fail closed — no break-glass on the authorize path

Shared store unreachable at commit time: `enforce` → DECLINE + `degraded`
(the money does not move — the brand); `advise` → verdict + degraded;
`shadow` → ALLOW + degraded. `/readyz` reports store reachability.
Registration (`POST /v1/intents`, mint) writes through synchronously —
an unreachable store refuses the write, it does not queue.

There is deliberately **no degraded-allow knob** for intent-bound kinds:
a flag that lets payouts proceed without confirmed consumption becomes a
misconfiguration CVE within a year. Break-glass belongs at the LB —
failover to a single fenced active (today's active-passive topology) —
never inside the verdict path.

### 6. Deployment modes (all stay supported)

| Mode | State | Correctness |
|---|---|---|
| single | memory + FileStateStore snapshot | today, unchanged |
| active-passive | PostgresStateStore snapshot CAS | today, unchanged |
| active-active | shared intents/reservations/dedupe/control | Phase 1 |

Phase 1 backend: Postgres (deploys already have it via `store-postgres`;
HA is RDS Multi-AZ/Patroni — a solved problem buyers already run). Redis
adapter implements the same seam later — a commit log, not a truth store,
unless persistence is configured; say so in its doc. In-memory remains
the default.

### 7. Cutover and proof are part of the feature

- **Import tooling**: single-node → active-active needs `state export →
  shared import` for reservations + `uses`, else a mid-flight intent
  double-spends at cutover.
- **Observability**: commit latency histogram, conflict-rate counter,
  store-unreachable gauge — the first external dependency on the verdict
  path must be measured from day one.
- **Chaos drill matrix**: kill -9 mid-commit, PG failover, partition,
  clock skew — the proof is adversarial, not the code review.
- **Auditor's sentence**: *authorisation counters are linearizable
  through a single Postgres transaction; everything else is bounded-stale
  by design, with named staleness.*

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
