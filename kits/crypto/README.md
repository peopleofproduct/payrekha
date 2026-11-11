# VDA-exchange kit

`npm run kit:crypto` → a month of withdrawals where **every payout cites two
intents from distinct issuers** — the trading engine's `wd-N` plus the risk
desk's `wd-N-appr` — exercising ADR 0003 m-of-n maker-checker.

Two planted anomalies:

- **Day 12** — `wd-rogue`: a withdrawal citing only the ops intent, no
  risk-desk approval → `intent.approvals-insufficient` **BLOCK**.
- **Day 19** — `wd-self`: the ops key signs its own "approval" — same
  issuer → `intent.approvals-not-distinct` **BLOCK**. This is why approver
  intents must come from a _different_ issuer's keyring.

**Expected report**: exactly those 2 BLOCKs, everything else ALLOW.

## Preset rationale

| Rule                               | Setting                                                    | Why                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `requiredApprovals.VDA_WITHDRAWAL` | `count: 2`, `approverIssuers: [trading-engine, risk-desk]` | the advisory's maker-checker ask — a single compromised signing key can never move funds alone              |
| `cooling`                          | 4 h, ≥ ₹2 lakh                                             | fresh withdrawal addresses are the account-takeover vector; exchanges cool new addresses longest            |
| `velocity`                         | 100/₹50cr per 10 min                                       | withdrawal sizes are inherently large — guard the _key_, not the flow                                       |
| `external`                         | 0.6/0.85                                                   | exchanges usually run an upstream scorer (chain analytics) — stricter bands since it's advisory-only anyway |

## Approver intents in production

The risk desk runs its own signer with its own keypair — it approves
_out of band_ (its queue, its latency), producing `wd-N-appr` intents the
payout cites in `approvalIds`. Approver intents must satisfy the same
beneficiary + amount + kind binding, so an approver can't be spoofed into
authorising a different withdrawal.

## Advisory rows

RA9, RA12 (maker-checker/multi-sig), RA11, RA18, RA23 — the strongest
crypto-segment reading of the advisory.
