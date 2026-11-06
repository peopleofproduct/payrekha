# Demo runbook

A 10-minute launch demo in three acts. Every command runs offline on a laptop once the images are pulled.

## Before you go on (do this the day before)

```bash
git clone https://github.com/peopleofproduct/payrekha && cd payrekha
npm ci && npm run build
docker compose -f deploy/docker-compose.yml pull          # Envoy, Prometheus, node images
docker compose -f deploy/docker-compose.yml up --build -d
npm run demo:live -- --auto                               # dry run; must end "₹0 left the building."
npm run replay -- --payouts examples/data/payouts.csv --intents examples/data/intents.csv --config examples/data/payrekha.json --out out/
```

- Terminal font at least 18 pt, a dark theme, and a window about 110 columns wide.
- Open `out/report.html` in a browser tab ahead of time.
- Turn on Do Not Disturb, and close any windows with tokens or customer data in them.
- All keys in the compose stack are fixed demo values. Never show a real `.env`.

## Act 1: the attack chain (2 min, `npm run demo`)

> "This is CRAFTY FALCON, from CERT-In advisory CIAD-2026-0058. The attacker is already inside a lender and is calling its own payout API with valid credentials."

Run `npm run demo`. Walk through the steps and stop on these:

| Step | What to say |
|---|---|
| Stolen LMS credentials, no intent | The credential is valid. What's missing is the business intent the LOS signs. |
| Replayed intent to a mule | An intent is tied to one beneficiary, one amount ceiling and a validity window. |
| ₹1 probe, then ₹4,99,999 | The same playbook as the advisory, caught by `probe.micro-then-large`. |
| Canary, then HIGH_ALERT | One canary hit locks everything down until an authenticated admin resets it. |

Close on the last line: **"8 attack steps. ₹0 left the building."** The dimmed line under it is the same run in shadow mode, which is how a team starts on day 1.

## Act 2: live, in front of a real proxy (4 min, `npm run demo:live`)

> "This needs no SDK and no code change. Envoy sits in front of an existing payout API and asks PayRekha about every call."

Run `npm run demo:live`. Press Enter to move to each step.

1. **Shadow:** the attack goes through, but the `BLOCK` verdict is logged. This is the zero-risk way to start.
2. **Enforce:** one admin call, which is recorded in the audit trail.
3. **The same attack:** `403`, `intent.missing`.
4. **The LOS signs an intent:** an Ed25519 key that only the system of record holds.
5. **The real disbursal:** `200`, and the money goes out.
6. **The stolen intent replayed to a mule:** `403`, `intent.beneficiary-mismatch`.
7. **Garbage input:** degraded `REVIEW`, so the payout is held. It is never a silent allow.
8. **What the SOC sees:** the Prometheus counters, plus the decision log, which holds hashed beneficiaries only:
   ```bash
   docker compose -f deploy/docker-compose.yml exec payrekha tail -n 3 /var/lib/payrekha/decisions.jsonl
   ```

The script puts the gateway back in shadow mode when it finishes, so you can run it again.

## Act 3: your own data, day 1 (2 min, the replay report)

> "Before you integrate anything, replay last month's ledger."

Show `out/report.html`. It covers 3,280 synthetic NBFC payouts with three planted attacks: all three are flagged, and only one legitimate payout goes to review. Then point out the false-positive list, which is the honest starting point for tuning.

## Likely questions

- **"What if PayRekha is down?"** The client fail mode is `hold-above:5000000`: payouts above ₹50,000 are held, and smaller ones go through.
- **"How fast is it?"** Measured p99 is about 19 µs in-process and 0.7 ms through the gateway (`npm run bench`).
- **"Does it see our customers' account numbers?"** No. Beneficiaries are converted to keyed HMAC hashes (`hb1_…`) as soon as they arrive, and raw identifiers are rejected.
- **"What if the attacker owns the LOS too?"** Then they hold the signing key, and the behaviour, canary and calendar rules are the remaining layers. See [threat-model.md](threat-model.md).
- **"Can it run as several copies?"** Today you get one active gateway with a standby, sharing state through Postgres. A shared store for running several copies at once is on the [roadmap](../ROADMAP.md).
- **"License?"** Apache-2.0.

## If something breaks on stage

| Problem | Fallback |
|---|---|
| Docker won't start | `npm run demo` alone tells the whole story with no network and no containers. |
| Stack is stuck in HIGH_ALERT or enforce mode | Run `npm run demo:live` again. It resets the alert and the mode at startup. |
| Port 8080 or 10000 is busy | `docker compose -f deploy/docker-compose.yml down`, free the port, then start again. |
| Colours unreadable on the projector | `NO_COLOR=1 npm run demo` |
