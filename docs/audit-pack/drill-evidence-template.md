# Drill evidence template

One file per drill execution — `drills/YYYY-MM-DD-D<n>.md` in your ops
repo. Auditors read these to confirm the failure-mode rows in
`../failure-modes.md` are _operational_, not theoretical.

```markdown
# Drill D<n> — <name> — <YYYY-MM-DD>

**Drill**: docs/drills.md#d<n> **Executed by**: <name> **Duration**: <m>
**Topology**: single | standby | active-active **Mode at drill**: shadow|advise|enforce

## Setup

<what was running, commit/tag, one line>

## Steps performed

<commands run / actions taken, verbatim where possible>

## Observed

- Metric: <which payrekha_* counter/gauge moved, before → after>
- Verdicts during the window: <counts, or "no payout impact">
- Decision-log/audit records produced: <record types seen>

## Pass criterion (from drills.md)

<stated criterion> → **PASS / FAIL**

## Gap found / follow-up

<"none" is a valid answer; if FAIL: owner + issue link + retest date>
```

Rules of engagement that keep this honest:

- Record **actual** metric values, not "as expected" — an auditor trusts
  `payrekha_shared_failclosed_total 0→3` and distrusts adjectives.
- A FAIL entry with a retest date is _stronger_ evidence than a clean
  sheet — it shows the drill exercises something real.
- Automatable drills (D1, D8) can attach the script's own output
  verbatim; manual drills (D2, D4, D9) need the human log above.
