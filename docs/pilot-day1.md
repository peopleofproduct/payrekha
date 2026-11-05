<!-- SPDX-License-Identifier: Apache-2.0 -->
# Day-0 / Day-1 pilot — advisory coverage inside a lender this week

For NBFCs, lenders and banks responding to CERT-In CIAD-2026-0058 (CRAFTY
FALCON): attackers are **inside** and calling your own payout APIs with valid
credentials — ₹1 probes, settlement-API abuse, UAT→prod pivots, repackaged-app
direct calls, holiday timing. This document is the fastest safe way to stand
Payrekha up on *your* infrastructure. Two properties make it liability-free:

1. **It cannot decline anything.** `shadow` mode always lets the payout
   through — every verdict is logged as "what it would have done."
2. **Nothing can phone home or leak.** Self-hosted inside your network;
   beneficiaries exist only as keyed hashes (`h:v1:`); no raw account, VPA or
   mobile is ever stored or logged. No vendor dependency, no data leaves
   your perimeter — DPDP-clean by construction.

If Payrekha itself crashes, payouts are unaffected (Envoy
`failure_mode_allow: true`). Removing it is deleting one filter — you are
exactly where you started.

## Day 0 — the one-hour proof (no infrastructure change)

**On one laptop, air-gapped if you like.** Two options, best first:

**A. Your own payout history (the real demo).** Export last month's payouts
to CSV, run the replay — it never touches a live system:

```bash
npm ci && npm run build
npm run replay -- --payouts ledger.csv --map map.json --out out/
# open out/report.html — one self-contained file
```

`map.json` renames your columns to ours (`payoutId`, `kind`, `amountRupees`,
`timestamp`, `account`, `ifsc`, `sourceKeyId` — see `docs/getting-started.md`).
What you get back: every payout that *would* have been held or declined, the
exact rule and evidence, a **false-positive review list** for tuning, and
whether advisory-shaped patterns (probe-then-large, new-beneficiary bursts,
UAT-origin calls, holiday windows) exist in your own data. Beneficiaries are
hashed with a throwaway key — the report contains no raw account numbers.

**B. Our synthetic month (if the export takes time).** 3,280 NBFC payouts
with three planted attacks:

```bash
npm run replay -- --payouts examples/data/payouts.csv --intents examples/data/intents.csv --config examples/data/payrekha.json
npm run demo        # the full CRAFTY FALCON chain: 8 attack steps, ₹0 leaves
```

**Day-0 exit criteria:** you have seen it work on real or realistic data, and
one named person owns what happens next.

## Day 1 — live shadow inside your network (still cannot hurt you)

### What you need

| Item | Effort |
|---|---|
| A VM or container host inside your VPC (1 CPU / 512 MiB) | existing infra |
| Docker (compose path) **or** Node ≥ 22 (bare binary) | minutes |
| One Kubernetes/… secret: `PAYREKHA_API_KEYS`, `PAYREKHA_ADMIN_KEY`, `PAYREKHA_HASH_KEY`, `PAYREKHA_STATE_KEY` | one secret |
| A `payrekha.json` (we ship shadow defaults — example below) | copy |
| **Either** Envoy in front of the payout API (zero code) **or** one `POST /v1/evaluate` call in your payout service | hours, not days |
| Somewhere for `decisions.jsonl` to land → your SIEM | existing pipeline |

### Config for week one (copy this)

```json
{ "firewall": {
    "mode": "shadow",
    "requireIntent": { "LOAN_DISBURSAL": false, "PA_SETTLEMENT": false, "REFUND": false,
                       "VDA_WITHDRAWAL": false, "VENDOR_PAYOUT": false, "VERIFICATION": false },
    "maxTimestampSkewMs": 300000 } }
```

(`requireIntent:false` during week one — your LOS isn't signing yet; the
behavioural rules are what day-1 exercises. All intent checks turn on the
moment you flip the flags.)

API keys are role-scoped — one line in your secret:

```text
PAYREKHA_API_KEYS='payout-svc:prod:evaluate+outcomes:<token>,grafana:prod:read:<token>'
```

### Two deployment shapes — pick by effort

**No code change — Envoy `ext_authz`.** The filter in `deploy/envoy/` calls
Payrekha before your payout API. `failure_mode_allow: true` means a Payrekha
outage can never hold a payout; `x-client-id` is asserted *by Envoy*, never
forwarded from the client. `docker compose -f deploy/docker-compose.yml up`
shows the whole shape.

**One API call — SDK.** Call `POST /v1/evaluate` in your payout path, act on
nothing yet — just log the verdict. Clients exist for Java/Python/Go/Node.

### Plant canaries on day one — this is the quick win

Even untuned, a canary is instant tripwire coverage. Plant a beneficiary that
*cannot legitimately receive money* (an account in your UAT bench, an old
test VPA) — the advisory explicitly recommends deception:

```bash
curl -XPOST localhost:8080/v1/canaries -H "authorization: Bearer $ADMIN" \
  -d '{"beneficiaries":[{"account":"<uat-bench-acct>","ifsc":"HDFC0000001"}],"reason":"day-1 tripwire"}'
```

Any payout touching it → `canary.tripped` → **HIGH_ALERT** (persists across
restarts, needs an authenticated reasoned reset). CRAFTY FALCON reuses
reconnaissance — a canary in the right place often sees the attacker before
your rules do.

## What your day-1 deployment already covers — advisory step by step

| Advisory behaviour | Rule watching it day-1 |
|---|---|
| ₹1 probe before large transfer | `probe.micro-then-large` (penny-drop-aware — see `docs/penny-drop.md`) |
| Settlement API abuse | `settlement.over-captured`, `settlement.account-changed` |
| UAT/staging → prod pivot | `origin.nonprod` (origin comes from the key, not the caller) |
| Repackaged-app direct calls | `client.unattested` (when attestation is wired) |
| Holiday/weekend/night timing | `calendar.window` → HOLIDAY tightens everything |
| Machine-speed drains | `velocity.outflow`, `amount.band-anomaly` |
| Mule/new accounts | `beneficiary.cooling`, `feed.reputation` |
| Assume persistence | `HIGH_ALERT` survives restarts, human-reset only |
| Deception | `canary.tripped` |
| Log/share with SOC | `decisions.jsonl` → SIEM (JSONL or CEF) |

Not covered — because nothing at this layer can be: patching, EDR, cloud
audit logs, identity/MFA, IoC blocking, CERT-In incident reporting. See
`docs/advisory-mapping.md` for the full boundary — Payrekha is the
payout-layer control inside a wider response.

## What you watch in week one

- `decisions.jsonl` → SIEM; `would-stop` entries are the tuning conversation
- `payrekha_verdicts_total`, `payrekha_rule_hits_total` in Grafana
- Named human on `PayrekhaHighAlert` + `PayrekhaNotReady` (`deploy/prometheus/alerts.yml`)
- `GET /v1/decisions` / `/v1/audit` for the analyst who wants to look, not query logs

## Week two and after

Replay week-1's own decision log → tune thresholds (`npm run replay`) → start
intent signing (tiered: `docs/adoption.md` — managed intents need one API
call; SDK signing is ~10 lines; KMS/HSM when regulated) → flip
`requireIntent` per kind → `advise` → `enforce` per kind. The intent layer is
the cryptographic guarantee that makes "no matching intent, no payout" real —
day-1 gets you the tripwires; tiers get you the wall.
