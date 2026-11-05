# Weekend protection kit — live in ~30 minutes, zero payout risk

For a lender/NBFC/bank responding to the CERT-In advisory **this weekend**.
Everything here runs **shadow mode**: Payrekha watches every payout and logs
what it *would* have stopped. It cannot decline traffic, and Envoy fails open
if Payrekha dies. There is no path by which this kit blocks a customer payout.

## What you get

- `deploy/quickstart/` — one compose file: Payrekha + Envoy + Prometheus + Grafana
- Grafana dashboard auto-provisioned (alert banner, verdicts, rule hits, latency, errors)
- `calendar.json` pre-armed for the Diwali/holiday window (edit to your SOC calendar)
- `verify-deploy` — 12-check post-install proof, including a live canary trip
- `deploy/siem/vector.toml` — copy-paste shipper for Splunk/Elastic/Sentinel

## Prerequisites

A Linux VM with Docker + docker compose, ~1 CPU / 512Mi free. No internet
dependency at runtime once images are pulled; nothing phones home.

## Step 1 — secrets (2 min)

```bash
cp deploy/quickstart/env.example deploy/quickstart/.env
# fill every value — generate each with: openssl rand -hex 24
```

## Step 2 — point Envoy at your payout path (5 min)

Edit `deploy/quickstart/envoy.yaml` — two spots marked `EDIT`:

1. `payout_api` cluster → your payout service host:port
   (`host.docker.internal:PORT` for a host service)
2. `headers_to_add` → `x-payrekha-key` = your `PAYREKHA_EXT_AUTHZ_KEY`,
   `x-client-id` = a stable name for the calling service

Edit `deploy/quickstart/prometheus.yml` — replace `REPLACE_WITH_READ_KEY`
with your `PAYREKHA_READ_KEY`.

Route: send your payout traffic to `http://<host>:10000` instead of the API
directly — or run the evaluate-API path instead (Step 4).

### Step 2b — map your payout JSON (2 min, do not skip)

The shipped mapping assumes a specific body shape. **Paste one real payout
JSON** (or a synthetic one with the same fields) and check before traffic:

```bash
node scripts/check-mapping.mjs --file sample-payout.json \
  --headers "x-payout-kind=LOAN_DISBURSAL,x-client-id=los-core"
```

It prints what resolves, what's missing, *why* (e.g. "account number must be
6–20 digits"), and every leaf path your JSON offers — then edit
`deploy/quickstart/payrekha.shadow.json` → `extAuthz.mapping` to match.

Common shapes → the mapping values to use:

| Your payload | `payoutId` | `amountPaise` | `channel` | beneficiary |
|---|---|---|---|---|
| NBFC LMS (shipped default) | `body.request_id` | `body.amount_in_paise` | `body.mode` | `body.beneficiary.account_number` + `.ifsc` |
| Payment aggregator (`{"id":…,"amount":…,"destination":{…}}`) | `body.id` | `body.amount` *(must be paise)* | `{"const":"IMPS"}` | `body.destination.account_number` + `.ifsc` |
| Crypto exchange (`{"withdrawal_id":…,"address":…}`) | `body.withdrawal_id` | `body.amount_paise` or a minor-units field | `{"const":"CRYPTO"}` | `beneficiary.address` ← `body.address`, `beneficiary.network` ← `body.network` |

Notes: `channel` accepts `IMPS|NEFT|RTGS|UPI|INTERNAL|CRYPTO` — use a
`{"const":"…"}` if your payload has no channel field. `amountPaise` must be an
integer in paise — if your API sends rupees, either convert upstream or send
`{"const"}`-style test traffic to the evaluate API instead. `kind` is what
your payout *is* (`LOAN_DISBURSAL`, `VENDOR_PAYOUT`, `REFUND`, `VERIFICATION`…);
a single payout path can pin it with `{"const":"LOAN_DISBURSAL"}`.

## Step 3 — up (5 min)

```bash
docker compose -f deploy/quickstart/docker-compose.yml up --build -d
```

Grafana at `http://localhost:3000` (admin / your `.env` password) — the
"Payrekha — Payout Protection" dashboard is already loaded. The **ALERT
STATE** panel going red is the thing to watch.

## Step 4 — prove it (5 min)

```bash
npm run verify:deploy -- --url http://localhost:8080 \
  --api-key $PAYREKHA_EVALUATE_KEY --read-key $PAYREKHA_READ_KEY \
  --admin-key $PAYREKHA_ADMIN_KEY
```

12 checks: health, readiness, mode=shadow, non-blocking proof, metrics,
canary registration → **live canary trip → HIGH_ALERT → audited reset**.
All checks must pass before routing real traffic.

## Step 5 — plant real canaries (10 min)

Register 2–3 trap beneficiaries only you know exist — a UAT-bench account,
a test VPA, a dormant vendor account. Any payout to one is, by definition,
an incident:

```bash
curl -X POST localhost:8080/v1/canaries \
  -H "authorization: Bearer $PAYREKHA_ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"beneficiaries":[{"account":"<UAT account>","ifsc":"<ifsc>"}],
       "actor":"security-team","reason":"advisory weekend canary"}'
```

Raw values are hashed at the gateway edge — never stored, never logged.

## Step 6 — eyes on (ongoing)

- **Grafana**: ALERT STATE + rule-hits panels; `canary.tripped` → respond now
- **SIEM**: point `deploy/siem/vector.toml` at your Splunk/Elastic/Sentinel —
  the decision log is JSONL, beneficiary-safe (hashes only)
- **Alerts**: Prometheus rules fire on HIGH_ALERT, webhook drops, log errors —
  route Alertmanager to whoever owns this weekend

## What this covers vs the advisory

Every payout through the path is checked against probe-then-large, new-
beneficiary velocity drains, UAT-origin keys, holiday/weekend/night windows
(armed by `calendar.json`), settlement account changes, and canary deception —
the payout-layer behaviours in CIAD-2026-0058. Scope honestly: this is the
payout control layer, not patching, EDR, or identity hardening — those run in
parallel in your wider advisory response.

## After the weekend

`docs/pilot-day1.md` → replay tuning → intent signing via `docs/adoption.md`
tiers → advise → enforce per kind. The shadow config you deploy today is the
same artifact — only `mode` and `requireIntent` change.

## Rollback

`docker compose -f deploy/quickstart/docker-compose.yml down` and route
payouts directly again. With `failure_mode_allow: true`, even an ungraceful
stop passes traffic — rollback is reversible by construction.
