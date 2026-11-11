# PSP / refund-flow kit

`npm run kit:psp` → a month of refund + new-payee verification traffic on
UPI, with two planted shapes:

- **Day 9, 12:00–12:45** — a refund mill: 60 refunds of ₹1–₹5 to ONE fresh
  VPA (`collect-mill@…`). Small enough to sit under amount thresholds;
  the pattern is the anomaly.
- **Day 25, 03:00** — 25 large refunds in 10 minutes, right shape/wrong hour.

**Expected report**: `velocity.outflow` REVIEWs where the mill crowds the
source-key window; night-batch rows flagged by probe/off-hours evidence.
Everything else clean.

## Preset rationale

| Rule            | Setting             | Why                                                                                                   |
| --------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| `requireIntent` | refunds + verifies  | refund intents from the order/refund engine                                                           |
| `probe`         | ₹500 large, 30×     | refund mills stay small — the _count_ to one beneficiary is the tell, so the window is tighter (12 h) |
| `cooling`       | 30 min, ≥ ₹100      | new payees cool briefly; verified payees are exempt (verified-beneficiary bookkeeping)                |
| `velocity`      | 150/₹50k per 10 min | refund APIs are chattier than disbursal paths but small-value                                         |

## First week

Refunds are your highest-FP-risk surface: run a full weekend+weekday cycle
in shadow, sort the `falsePositiveReview` list in the replay report before
enforcing — refund customers expect speed, so HOLDs should be explainable.

## Advisory rows

RA9, RA11, RA18, RA23; the refund-mill shape maps to the advisory's
mule-account accumulation guidance.
