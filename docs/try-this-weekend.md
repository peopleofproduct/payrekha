# Try PayRekha this weekend — a lender team's runbook

_For the security, payments or platform team at an NBFC, lender, bank or
payment aggregator who read the CERT-In advisory and wants payout-layer
coverage **before Monday**._

**The promise in one line:** by Sunday night you'll have PayRekha watching
every payout in shadow mode — logging what it _would_ have stopped, with
canaries planted — and **zero possibility of it touching a customer payout.**

---

## What "success" looks like Sunday night

- PayRekha running inside your network in **shadow mode** — it observes, it
  never blocks. If it crashes, traffic flows anyway (fail-open).
- A Grafana board showing verdicts, rule hits and the would-stop rate.
- 2–3 **canary beneficiaries** planted — accounts only you know are traps.
- A decision log your SIEM can already consume.
- A short evidence pack for Monday: _here is what it saw, here is what it
  would have stopped._

Nothing leaves your network. Beneficiary identifiers are hashed at the edge.
No licence agreement, no vendor onboarding — it runs on your iron, today.

> **Faster paths since this doc was written**: `npm run init` builds a complete segment-tuned shadow stack in one command (instead of the manual quickstart below); `npm run kit:<lender|pa|psp|crypto>` runs a ready-made segment demo with planted attacks; and `GET /console` on the gateway is a triage UI — the curls below all still work, they're just not required anymore.

## The deal you'll make with your team

| You give                                    | ~4 hours total, spread over the weekend    |
| ------------------------------------------- | ------------------------------------------ |
| A VM or container host                      | 1 CPU, 512 MB — that's the whole footprint |
| One config file + one Envoy edit            | We ship the templates                      |
| Your attention when the red panel lights up | That's the point of it                     |

---

## Friday · Hour 1 — see the value before you install anything

**No infrastructure touched. A laptop and a CSV export.**

```bash
git clone https://github.com/peopleofproduct/payrekha && cd payrekha
npm ci && npm run demo          # 10 seconds: the full CRAFTY FALCON chain
```

You just watched 8 attack steps — stolen credentials, ₹1 probe, UAT key,
holiday burst, changed settlement account, canary trip — and _"₹0 left the
building."_ That was the engine, locally, in shadow-then-enforce modes.

**Now your own data.** Export last month's payouts (even a week) as CSV —
`payoutId, kind, amount, beneficiary, channel, timestamp`. Then:

```bash
npm run replay -- --payouts your-ledger-export.csv
```

You get a terminal summary plus `report.html`: which advisory-shaped
patterns exist in _your_ data, what PayRekha would have flagged, and —
just as important — **the false-positive list you'd need to tune**. This
is the 30-minute answer to "is there anything here for us?"

> **Tag your penny drops.** If your export's `kind` column marks
> account-verification payouts as `VERIFICATION`, replay treats them as
> the lender vouching for that beneficiary — they won't read as probes or
> fresh-beneficiary flags. Untagged ₹1 rows still look like the attack
> pattern; the report will tip you if it sees micro payouts and no
> VERIFICATION rows. The report also prints **suggested starting
> thresholds** computed from your export's own distribution — paste them
> into `payrekha.json` before judging the verdicts.

> Stop here if you want. You already have evidence for Monday. Everything
> below makes it _live_.

---

## Friday · Hour 2–3 — live shadow inside your network

Everything lives in `deploy/quickstart/`. Four files you'll touch:

```bash
cp deploy/quickstart/env.example deploy/quickstart/.env
# fill every value — openssl rand -hex 24 each
```

Then three small edits (each marked `EDIT` in the files):

1. **`envoy.yaml`** → `payout_api` cluster = your payout service host:port;
   `x-payrekha-key` = your `PAYREKHA_EXT_AUTHZ_KEY`; `x-client-id` = a name
   for the calling service.
2. **`payrekha.shadow.json`** → run `node scripts/check-mapping.mjs
--file <one real payout JSON>` first — it tells you exactly which
   mapping lines to fix for _your_ payload shape. 2 minutes, no guessing.
3. **`prometheus.yml`** → paste your `PAYREKHA_READ_KEY`.
4. **`calendar.json`** → the Diwali window is pre-armed. Add your
   thin-staffing dates if different.

```bash
docker compose -f deploy/quickstart/docker-compose.yml up --build -d
npm run verify:deploy -- --url http://localhost:8080 \
  --api-key $PAYREKHA_EVALUATE_KEY --read-key $PAYREKHA_READ_KEY \
  --admin-key $PAYREKHA_ADMIN_KEY
```

**12 checks must pass** — health, shadow non-blocking proof, metrics, and a
_live canary trip_ that raises HIGH_ALERT and resets under audit. If all 12
are green, the stack is real, not just "up."

Now point payout traffic at `http://<host>:10000` (Envoy) — or have your
payout service `POST /v1/evaluate` directly. Both paths are in the kit.

---

## Friday evening — plant the canaries

The advisory's recommended control is **deception**: assets an attacker can
touch but no legitimate process ever uses. Register 2–3:

```bash
curl -X POST localhost:8080/v1/canaries \
  -H "authorization: Bearer $PAYREKHA_ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"beneficiaries":[{"account":"<UAT-bench account>","ifsc":"<ifsc>"}],
       "actor":"security-team","reason":"advisory weekend canary"}'
```

Ideas: a UAT-bench account, a test VPA, a dormant vendor account that can
never legitimately receive money. **Any payout to one is, by definition,
an incident** — it fires `canary.tripped`, pushes the gateway to
`HIGH_ALERT`, and that state survives restarts until a human resets it.

---

## Saturday–Sunday — watch

- **Grafana** `http://<host>:3000` — the _ALERT STATE_ panel, verdicts vs
  effective actions (the gap = what it would have stopped), rule-hit ranking.
- **SIEM** — point `deploy/siem/vector.toml` at your Splunk/Elastic/Sentinel.
  The decision log is JSONL, beneficiary-safe (hashes only) — DPDP-clean.
- **Alerts** — Prometheus rules fire on HIGH_ALERT, webhook drops, log
  errors. Route Alertmanager to whoever's on call this weekend.

You don't need to babysit it. If nothing trips, that's signal too.

## Monday morning — the evidence pack

Pull for your review with leadership:

```bash
curl -s localhost:8080/v1/decisions?verdict=BLOCK \
  -H "authorization: Bearer $PAYREKHA_READ_KEY" | jq '.decisions[:20]'
curl -s localhost:8080/v1/decisions?verdict=REVIEW \
  -H "authorization: Bearer $PAYREKHA_READ_KEY" | jq '.decisions[:20]'
```

What you now know that you didn't on Friday: which rules fired, at what
rate, whether anything canary-shaped moved, and your false-positive profile
for tuning. That _is_ the business case for week 2.

## After the weekend — the four-step ladder

| Step        | When              | What changes                                          |
| ----------- | ----------------- | ----------------------------------------------------- |
| ✅ Replay   | Friday, done      | —                                                     |
| ✅ Shadow   | This weekend      | —                                                     |
| **Advise**  | Week 2–3          | Payout service reads verdicts; ops reviews holds      |
| **Enforce** | When you're ready | Per payout kind, riskiest first (crypto, settlements) |

Graduation detail: [docs/pilot-day1.md](pilot-day1.md) →
[docs/adoption.md](adoption.md) → [docs/drills.md](drills.md).

## Rollback, always one command away

```bash
docker compose -f deploy/quickstart/docker-compose.yml down
```

Route traffic directly again — with `failure_mode_allow: true` even a hard
kill passes payouts. Reversible by construction: that's the whole design.
