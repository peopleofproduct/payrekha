# Beta → GA criteria

Explicit gates for calling PayRekha `1.0` — each is measurable, has an
owner of evidence, and is either met or it isn't. Beta (alpha tags) ends
when **all gates pass**; the `1.0.0` tag is the assertion that they did.

## G1 — Production pilots

- ≥ **3 real production deployments**, at least one each in **two
  different segments** (lender / PA / PSP / crypto).
- Each runs **≥ 30 days** in `shadow` or stronger.
- Each has a named operator contact who will vouch (written reference or
  recorded call) for the operational story.
- **Evidence**: pilot log + contact, in the release PR.

## G2 — Measured false-positive rate

- Shadow data from each pilot yields a computed **FP rate per rule id**
  (REVIEW+BLOCK on payouts that later settled normally ÷ evaluated).
- Rules above the per-segment budget get **tuned or documented** — a rule
  that stays noisy must ship a documented "why we keep it" in its kit
  README, not silent noise.
- **Budgets (starting point, revisable with data)**: net REVIEW+BLOCK
  ≤ 2% of evaluated in shadow; no single rule > 1% unless it's a named
  planted-anomaly rule doing its job.

## G3 — Sustained SLO

- p99 `/v1/evaluate` ≤ **5 ms** over a rolling 7-day window at each
  enforce-mode pilot (capacity envelope has the measurement harness —
  `payrekha_eval_latency_micros` + `payrekha_shared_commit_ms_*`).
- Zero **unexplained** `payrekha_*_errors_total` growth; every counter
  bump maps to a failure-modes.md row or an incident with a write-up.
- ≥ 1 completed **drill cycle**: D1 (crash), D2 (promotion), D4 (key
  compromise), and D8/D9 if active-active is in use.

## G4 — Compatibility & upgrade contract

- **Semver adopted and stated**: snapshot migrations ship as code (never
  a manual runbook step), API changes are additive-or-versioned, config
  keys deprecate over ≥ 1 minor.
- An **upgrade drill** exists: install N, run, upgrade to N+1, verify
  intents/reservations/decision-log continuity — rehearsed once on a
  real pilot.
- Client libraries across JS/Java/.NET/Go/Python pass the shared
  `clients/vectors/` conformance vector at the release commit.

## G5 — Documentation completeness audit

- Every `docs/` page is current against the code it describes (checked
  by walking each doc's code references at release-prep).
- `failure-modes.md` rows all map to a live metric or drill — no row
  silently rots.
- Quickstart → shadow → enforce path is cold-runnable by an engineer who
  has never seen the repo: verified on a clean machine/VM.
- `docs/audit-pack/` (D2) exists and answers an auditor checklist
  without an engineer in the room.

## G6 — Security posture

- Fuzz suite (`npm run fuzz`) runs in CI; no crash-class finding sits
  unfixed.
- External review (E1/E2) has happened at least once; every HIGH/CRIT
  finding is fixed or has a written, owner-signed acceptance.
- `repository-settings.md` claims are all true in the live repo
  (protected branch, signed commits, pinned actions, provenance on).

## What GA does _not_ require

- No minimum revenue, logo count, or feature checklist beyond the above.
- Wave-3 items (console, Apigee/AWS gateways, D-certifications) are
  _post-GA roadmap_, not gates — a 1.0 can ship without them.
- GA is a **safety statement**, not a completeness one: it says "the
  controls in this box are proven on real money," nothing more.

## Sign-off

Each gate's evidence is attached to the release PR; two maintainers +
one pilot operator sign it. If any gate is judgment-called, the call is
recorded with a name and date — a GA tag signed on vibes is a beta.
