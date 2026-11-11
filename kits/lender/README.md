# Lender kit (NBFC / LMS)

`npm run kit:lender` → a month of penny-drops → disbursals → refunds replayed
through the preset config, with two planted attack shapes:

- **Day 14, ~02:00** — 30 payouts through `lms-prod` to fresh VPAs with **no
  intents** (8 micro probes, then large amounts). This is a compromised
  caller key running at machine speed.
- **Day 21, 13:05** — 40 disbursals fired through `refunds-svc` citing
  intent ids that don't exist — the wrong-key/wrong-shape anomaly.

**Expected report**: `intent.missing` BLOCKs on both clusters; zero REVIEWs
on normal traffic (thresholds sit comfortably above the data).

## Preset rationale (`payrekha.json`)

| Rule            | Setting                                           | Why                                                                                                         |
| --------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `requireIntent` | disbursals + refunds                              | the advisory's core: money moves only against a signed intent                                               |
| `cooling`       | 1 h, ≥ ₹5,000                                     | penny-drop → disbursal normally takes a day; same-hour large payouts to new accounts are the takeover shape |
| `probe`         | ₹10k, 25× window                                  | micro-verification bursts precede bulk theft                                                                |
| `velocity`      | lms-prod 120/₹5cr, refunds-svc 60/₹1cr per 10 min | ~40 disbursals/day peak; refund amounts are ≤ ₹5k                                                           |

## Your first week

1. **Day 1–2** — `payrekha-replay` your own LOS export (same CSV columns);
   confirm `skippedRows` is empty and REVIEWs are explainable.
2. **Day 3–4** — deploy shadow with this config; `PAYREKHA_STATE_FILE` on a
   persistent volume; watch `payrekha_decisions_total{verdict="REVIEW"}`.
3. **Day 5** — tune any FP source keys via `perSourceKeyOverrides`.
4. **Day 6–7** — `mode: enforce`, `LOAN_DISBURSAL` first; refunds next sprint.

## Advisory rows this kit exercises

RA9 (intent-bound payouts), RA11 (behavioural velocity/cooling),
RA13 (penny-drop verification path), RA18 (credential-burst detection),
RA23 (SIEM-visible machine-speed anomalies).
