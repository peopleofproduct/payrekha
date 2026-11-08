# RBI PA/PG guidelines + settlement reconciliation

For payment aggregators and gateways — where the advisory's
"settlement abuse" concern lands hardest.

| Obligation theme | PayRekha evidence | Owner |
|---|---|---|
| Settlement integrity — settle only what was collected | `settlement.over-captured`: a `PA_SETTLEMENT` payout exceeding the reconciled merchant balance blocks | product |
| Settlement account changes are high-risk | `settlement.account-changed` forces REVIEW when a merchant's settlement destination changed recently — the classic PA fraud vector | product |
| Merchant-level isolation | `merchantIds` on API keys: a merchant-scoped key cannot submit payouts for another merchant (403); shared velocity/ledger state is keyed by merchant | product |
| Per-merchant velocity | `velocity.outflow` budgets scope per `merchantId` as well as per API key and global | product |
| Reconciliation evidence | Every decision logs `merchantId` + `intentId` + verdict — `evidence-extraction.md` jq pulls a per-merchant settlement timeline for your recon team | product |
| Escrow/nodal account discipline | **Operator**: which account settles where is your banking arrangement — PayRekha verifies the payout matches its intent, it doesn't police the nodal account itself | operator |
| Merchant KYC/onboarding | **Operator**: PayRekha sees `merchantId` strings, not KYC status | operator |
| PA-specific intent kinds | `PA_SETTLEMENT` is a first-class intent kind with its own `requireIntent` toggle — a settlement can't bind a `VENDOR_PAYOUT` intent (`intent.kind-mismatch`) | product |

See `kits/pa/` for the reference deployment — its planted attack is a
post-account-change settlement drain, caught by `settlement.account-changed`.
