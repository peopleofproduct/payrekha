# Payrekha for leadership — the CXO playbook

*For CEOs, CFOs, COOs and boards of NBFCs, lenders and banks. Plain words.
What happened, what we can do about it this week, and what it costs.*

---

## The situation in one paragraph

India's cyber agency (CERT-In) issued an advisory this week: attackers are
moving money out of financial institutions **during the Diwali window**, and
they're not hacking in — they're **using our own keys**. Stolen API
credentials, insider access, vendor accounts. Every payout looks legitimate
because it *is* — a real credential making a real API call. The money leaves
before anyone notices.

Your systems currently ask *one* question before moving money: **"is this a
valid key?"** The advisory says that's no longer enough.

## What Payrekha is

One additional question before money leaves: **"was this payout actually
decided?"**

Think of it as a second signature on the cheque — but a signature only the
system that *approved* the loan or settlement can produce. Stolen key?
Doesn't matter. Insider? Doesn't matter. **No matching intent, no payout.**
That's the whole product.

## The important part: trying it is free and safe

| What it costs | What you get |
|---|---|
| ~4 hours of one engineer's time | A working system watching your payouts by Sunday |
| Zero rupees — it's open source | No licence, no vendor negotiation, no procurement cycle |
| Zero customer risk — it runs in watch-only mode | It *cannot* block a payout — that mode is a guarantee, not a setting |
| Runs inside your own servers | No data leaves; beneficiary details are hashed before they're even stored |

We're asking for **one weekend of watching**, not a platform purchase.

## Why this, and why now

**Why now** — the attack window is this weekend. Every week of shadow data
is a week of evidence; deploying after Diwali protects you from a window
that already closed.

**Why this** — the honest comparison:

| Option | Time to value | Cost | Coverage of this threat |
|---|---|---|---|
| **Payrekha** | This weekend | ₹0, open source | Built *for* the credential-intrusion pattern in the advisory |
| Fraud-scoring vendors | Months (integration + tuning) | Enterprise licence | Scores transactions; doesn't *authorize* them — and still trusts your keys |
| Build in-house | Quarters | Eng roadmap | You'd build this exact primitive — intent binding — which is the hard part |
| Do nothing this week | 0 | ₹0 | Blind during the highest-risk window of the year |

There's no pitch here that a mature vendor can't make *eventually* — the
difference is this can be watching your payouts **Friday night**, while
procurement cycles are still printing.

## What success looks like

- **Monday:** your security team shows you a board — *here's what ran,
  here's what it would have stopped, here's our false-positive list.*
- **Week 2–3:** verdicts start informing your payout service; holds get
  human review.
- **Month 1+:** you choose to enforce on your riskiest payout type (crypto
  withdrawals, merchant settlements — wherever the exposure is worst).
- **Always:** a decision log and audit trail that answer auditors and
  CERT-In the day they ask.

## The questions you'll want answered

**"What if it breaks?"** — It's designed to fail *open*: if it crashes,
payouts flow. Shadow mode means even a wrong answer can't stop money. We've
proven that live in our own CI.

**"Is it production-ready?"** — Honestly: it's alpha. The engine is tested
and hardened; the thresholds haven't met *your* traffic yet — which is why
it starts watching, not blocking. You enforce when the evidence says so.

**"Who made it?"** — Open source, from the same team as Panini and
Krediwall. Mapped to the CERT-In advisory. You can read every line before
you run it — that's the point of shipping the source.

**"What do we actually decide today?"** — Three things:
1. Nominate one engineer + one security owner for the Friday runbook.
2. Authorize 2–3 canary beneficiaries (test/trap accounts).
3. Block Monday's review — the evidence pack is the deliverable.

## The line that summarizes it

> *Ravana never broke the Lakshman Rekha — he came disguised and got Sita to
> step outside. These attackers won't break our payment rails either —
> they'll show up dressed as our own systems and ask our money to step out.
> Payrekha is the line that holds anyway.*

It's Diwali week. The guardian is thin. Put the line down.

**Next step for your team:** [try-this-weekend.md](try-this-weekend.md) —
a one-page runbook they'll actually enjoy. For the security detail:
[playbook-ciso.md](playbook-ciso.md). For the product view:
[playbook-pm.md](playbook-pm.md).
