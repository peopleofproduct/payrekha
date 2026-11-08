# PayRekha for product teams — the PM playbook

*For product managers at NBFCs, lenders, payment aggregators and banks who
need to answer "why does this thing exist, what does it touch, and what do I
have to do about it?" — in plain language.*

---

## The 60-second version

> "Our payout APIs are reachable by anyone holding a valid credential —
> employees, vendors, scripts, and sometimes attackers. CERT-In's advisory
> describes attackers doing exactly that. PayRekha adds a second key: money
> only moves when the system of record says it was supposed to. It runs in
> our own infra, can't block payouts in observe mode, and costs us almost no
> engineering time to try."

If someone asks for the one-line version: **"It's a permission slip for
payouts — no matching intent, no payout."**

## Why this exists (the product problem, not the security jargon)

Your payout stack is built on a single assumption: *if a call carries a
valid API key, it must be legitimate.* That assumption fails the day a
credential leaks, a vendor laptop is compromised, or a script goes rogue —
because every downstream system trusts the *caller*, never asks whether the
*payout itself* was ever decided.

The CERT-In advisory for this week describes that exact failure mode: not
fancy exploits — **attackers inside, using your own APIs correctly**. Your
API gateway, WAF and IAM all see a valid call. Nobody asks *"was this
disbursal ever sanctioned?"*

PayRekha asks that question. Two keys instead of one:

1. **The intent key** — your LOS / recon engine / withdrawal approver signs
   a small cryptographic promise: *this loan, this ceiling, this
   beneficiary, valid until this time.*
2. **The payout key** — whatever moves the money must *show* a matching
   intent. Stolen key without intent → the payout doesn't pass. Even an
   insider with real production credentials can't move un-sanctioned money.

Plus a rules layer for the behavioural patterns in the advisory:
₹1-probe-then-large, brand-new beneficiaries, holiday/weekend bursts, UAT
keys in prod, changed settlement accounts, and **canaries** — trap
beneficiaries that make "someone is inside" visible the moment it happens.

## What this touches in your roadmap

Honestly: very little.

| Tier | Engineering effort | What changes for your product |
|---|---|---|
| **Kit demo** | ~0 | `npm run kit:<lender\|pa\|psp\|crypto>` — a segment demo with planted attacks, no setup |
| **Init + console** | ~0 | `npm run init` → shadow stack + `/console` triage UI — the fastest "see it work" |
| **Replay** | ~0 | Analyst exports a CSV, runs it on a laptop |
| **Shadow** | ~1 eng-day | Traffic passes through Envoy/NGINX/Kong/Traefik; nothing else changes |
| **Mint (managed intents)** | 1 API call | LOS calls `POST /v1/intents/mint` at approval time |
| **SDK-signed intents** | ~10 lines | Your service signs intents itself — strongest posture |
| **KMS/HSM signing** | same payload, your KMS | Regulated end-state, key never leaves your HSM |

Nothing customer-facing changes until *you* turn on enforcement per payout
type. Shadow mode is observability, not a product feature — your users will
never know it's there until you want them to.

## The questions you'll get, with answers

**"Does it add latency?"**
The engine answers in microseconds (~19µs p99 measured in-process, sub-ms
through the gateway). It's the same order as a Redis call, not a fraud-API
round trip.

**"What about false positives blocking real payouts?"**
Shadow mode exists precisely for this: it **cannot block** — it only logs
what it *would* have done. You run it for a week, replay-tune thresholds on
your own data, then enforce per payout kind when the false-positive list is
short enough for your risk appetite.

**"What does it do with beneficiary PII / DPDP?"**
Raw account numbers, VPAs, wallet addresses are hashed at the edge with a
key you hold. PayRekha never stores, logs or emits the raw value — the
decision log carries `hb1_…` refs only. It runs inside your VPC; nothing
phones home.

**"Is this a fraud platform?"**
No — and that's deliberate positioning, not a gap. Feedzai/SEON/Sardine
*score* transactions; PayRekha *authorizes* them. It accepts upstream risk
scores as advisory inputs (`riskScore`/`externalVerdict`), so it layers
*under* whatever you already own instead of competing with it.

**"What's the catch / maturity?"**
Alpha (`0.1.0`). Thresholds are defaults until tuned on your data. There's
a built-in triage console at `GET /console` (HIGH_ALERT panel, HOLD queue,
verdicts timeline, canary registration) plus the read API + Grafana
dashboard — no hosted service. It's open source — read the engine before
you trust it.

## What you own as PM

- **Would-stop rate** — verdicts vs effective actions; the honest signal of
  how much was at risk
- **Intent coverage** — % of payout volume carrying valid intents (the path
  to enforcement readiness)
- **False-positive list** — from replay reports; your tuning backlog
- **Adoption milestone** — which tier you're on this quarter; enforce is a
  *decision you make*, not a date we set

## How to brief your leadership in 3 lines

> "Attackers this quarter aren't breaking our APIs — they're using them
> correctly with stolen keys. This adds a second key only the system of
> record holds, so stolen credentials alone can't move money. We're running
> it in watch-only mode this weekend — zero risk, real evidence by Monday."

Then point at [try-this-weekend.md](try-this-weekend.md) — it's written for
the team doing the work, not for slides. For a structured stack-by-stack
path, [trials.md](trials.md) picks the right integration per their infra.
