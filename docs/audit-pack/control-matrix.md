# Control matrix — CERT-In CIAD-2026-0058 → PayRekha

Condensed auditor view; the full line-by-line review lives in
`../advisory-review-ciad-2026-0058.md`, the feature table in
`../advisory-mapping.md`. Status legend: **P** = product control shipped +
tested · **O** = operator responsibility (named, not claimed).

## Product controls (all shipped, all tested)

| Advisory requirement                                              | Control                                                                                                | Evidence an auditor can run                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Attackers use the entity's own payout APIs with valid credentials | Signed intents from an independent system of record; unsigned payouts BLOCK per `requireIntent`        | `npm run kit:lender` — the planted "no intent" row blocks; rule `intent.missing`                           |
| Re-use / tamper legitimate transactions                           | Intent binds amount ceiling, beneficiary (`hb1_`), window, `maxUses`; atomic uses at commit            | `intent.amount-exceeds`, `intent.beneficiary-mismatch`, `intent.expired`, `intent.reused` — registry tests |
| ₹1 probes before large transfers                                  | Probe detection + `VERIFICATION` intents                                                               | `probe.micro-then-large` fires in every kit demo                                                           |
| PA settlement abuse                                               | Settlement capped at reconciled amount; account-change review                                          | `settlement.over-captured`, `settlement.account-changed`; `npm run kit:pa`                                 |
| UAT/staging keys moving production money                          | Origin is a property of the authenticated key/edge — never the body                                    | `origin.nonprod`; `sourceKeyId`/`origin` are gateway-asserted (`server.ts`)                                |
| Repackaged apps calling APIs                                      | `clientAttested` requirement per kind                                                                  | `client.unattested`                                                                                        |
| Holiday/weekend-timed attacks                                     | IST calendar windows tighten thresholds                                                                | `calendar.window`; kits ship `calendar.json`                                                               |
| Machine-speed volume                                              | Per-key/merchant/global outflow budgets                                                                | `velocity.outflow`; load-check envelope in `../capacity-envelope.md`                                       |
| New/mule beneficiaries                                            | Cooling + operator fraud feed                                                                          | `beneficiary.cooling`, `feed.reputation`                                                                   |
| Persistence after remediation                                     | `HIGH_ALERT` never expires; authenticated reasoned reset; survives restart                             | drill D6; `alert.reset` audit record                                                                       |
| Deception                                                         | Canaries (beneficiary, key, intent)                                                                    | `canary.tripped` → HIGH_ALERT                                                                              |
| Untrusted clients / replay                                        | Server-side re-validation; replayed `payoutId` replays the stored verdict — it cannot re-execute       | `deduped: true` in the decision log                                                                        |
| Unusual source for a credential                                   | Edge-asserted `sourceHint` fingerprinting                                                              | `identity.fingerprint`; source never caller-asserted                                                       |
| Multi-sig withdrawals                                             | m-of-n approvals from **distinct** issuers                                                             | `npm run kit:crypto` — 2-of-2 on `VDA_WITHDRAWAL`; `intent.approvals-insufficient` / `-not-distinct`       |
| Transaction monitoring to SOC                                     | JSONL/CEF decision log, Prometheus, signed webhooks                                                    | `decision-log-schema.md`; `../integrations/siem.md`; drill D7                                              |
| Key management                                                    | Per-issuer keys, scoped kinds, `notAfterMs`, revocation propagates on next commit (~0ms active-active) | drill D4 + D5; `../kms.md`                                                                                 |
| Least privilege / hardening                                       | Non-root RO container, hashed tokens, admin token split, fail-closed on store loss                     | `../threat-model.md` §hardening; `../failure-modes.md`                                                     |
| Supply-chain integrity                                            | Signed commits, pinned actions, provenance, cosign, SBOM                                               | `../repository-settings.md`                                                                                |

## Operator responsibilities (declared — PayRekha does not claim these)

Cloud audit logging & retention · cloud control-plane hardening (IMDS,
roles, egress) · patching/vuln management incl. WAF · EDR & endpoint
hardening · file-integrity monitoring · AI-tooling detection & LLM
governance · MFA/PAM · removing exposed UAT (PayRekha only refuses the
money) · your repos' branch protection · pentest authorization policy ·
org-wide zero-trust (PayRekha = the payout-path slice) · vendor mTLS at
fetcher endpoints · restricted CERT-In IOCs (behaviour-keyed by design) ·
**CERT-In/CSIRT-Fin + I4C/CFCFRMS reporting itself** — the runbook +
`evidence-extraction.md` make the report producible, the filing is yours ·
network policy that makes PayRekha the only payout route.

**Honest gaps within product scope**: none open — see the review doc's
final score. Historical note for the auditor: m-of-n and geo/ASN
enrichment were the last two partials; m-of-n shipped (A3), geo stays
SIEM-side by design.
