# Payment-aggregator kit

`npm run kit:pa` → a month of T+1 settlement cycles to 40 merchants,
with one planted **settlement-reroute takeover** on day 17:

- 09:02 — merchant `m-107`'s settlement account "changes"
  (`account_changed` event — how a real engine reports it).
- 18:12 — a same-day ₹28 lakh settlement goes out to the NEW account.

**Expected report**: `settlement.account-changed` REVIEWs on the reroute
chain — the engine correlates the account change with the same-day settle.
Normal cycles pass clean.

## Preset rationale

| Rule              | Setting                              | Why                                                                                           |
| ----------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `requireIntent`   | PA_SETTLEMENT only                   | settlement engine signs every cycle payout                                                    |
| `merchantAccount` | `settleWindowMs: 24h`                | same-day settle to a changed account is THE takeover shape for PAs (advisory's core scenario) |
| `velocity`        | settlement-svc 500/₹500cr per 10 min | batches are bursty by design — sized ~2× the biggest observed batch                           |
| `cooling`         | 2 h, ≥ ₹1 lakh                       | settlement recipients are known accounts; new ones cool                                       |

## Wiring `account_changed` in production

Your settlement system emits an event when a merchant's payout account is
updated — the connector kit (`connectors/`) can mint it as an intent or the
ext_authz mapping can carry it as an event row. The rule then compares
settle-time vs change-time per `merchantId`.

## First week

Shadow the full settlement batch for a week — PA volumes are cyclical, so
cover at least one month-end before enforce. Alert on
`settlement.account-changed` from day one in shadow: it's the control the
advisory was written about.

## Advisory rows

RA9, RA10 (account-change correlation), RA11, RA18, RA23.
