# Advisory mapping: CIAD-2026-0058 (CRAFTY FALCON)

*Mapped to the public advisory text. Not affiliated with or endorsed by CERT-In.*

This table covers only the recommended actions that concern **payouts**: money leaving the entity through its own APIs. PayRekha is one control among many, and the second table lists what it does not cover.

| Advisory concern / recommended action | PayRekha feature | Rule / setting |
|---|---|---|
| Attackers call the victim's own payment and disbursement APIs with valid credentials | Every payout must match a signed business intent from a separate system of record | `intent.missing`, `intent.bad-signature`, `intent.kind-mismatch` |
| Re-use or tampering of legitimate transactions | Intents bound to amount ceiling, beneficiary, validity window and use count | `intent.amount-exceeds`, `intent.beneficiary-mismatch`, `intent.expired`, `intent.reused` |
| ₹1 test transfers before large transfers | Probe detection that tells a lender's penny-drop apart from an attacker's probe | `probe.micro-then-large`, `VERIFICATION` intents |
| Abuse of payment-aggregator merchant settlement APIs | Settlement limited to the reconciled amount; review after a settlement account change | `settlement.over-captured`, `settlement.account-changed` |
| Movement from exposed UAT/staging into production | The origin comes from the authenticated API key; non-prod keys cannot move money | `origin.nonprod` |
| Repackaged mobile apps calling APIs directly | Optional app-attestation requirement per payout kind | `client.unattested` |
| Attacks timed to holidays and weekends | IST holiday calendar and night/weekend windows tighten thresholds automatically | `calendar.window`, `HOLIDAY` state |
| Machine-speed, high-volume abuse | Outflow budgets per API key, per merchant and globally | `velocity.outflow`, `amount.band-anomaly` |
| Large transfers to new or mule accounts | Cooling period for beneficiaries first seen minutes ago; operator-loaded fraud feed | `beneficiary.cooling`, `feed.reputation` |
| Assume persistence; entities were re-attacked after remediation | HIGH_ALERT never expires; it needs an authenticated, reasoned reset and survives restarts | `HIGH_ALERT`, `PUT /v1/state` |
| Deploy deception to detect intruders | Canary beneficiaries, API keys and intents | `canary.tripped` → `HIGH_ALERT` |
| Treat client applications as untrusted; server-side validation and request signing | Every payout re-validated server-side; an intent is a signed business approval bound to kind, amount, beneficiary, window and use count — replay is structurally dead | `intent.*` rules, payoutId↔intent binding |
| Alert on token usage from unusual source IPs, user agents or geographies | `identity.fingerprint`: an API key's first edge-asserted `sourceHint` enrols; a changed hint REVIEWs (peer IP on /v1/evaluate, proxy-header mapping on ext_authz — never the body). Geo/ASN enrichment stays SIEM-side | `identity.fingerprint`, `sourceHint` in the decision log |
| Multi-signature approvals for withdrawals | Single-signer intents today: a payout binds exactly one intent from one issuer ("two keys to move money"). m-of-n co-approval is planned | see exclusions |
| Monitor and log transactions; share with SOC | JSONL/CEF decision log with rule IDs and evidence, Prometheus metrics, signed SOAR webhooks | [SIEM](integrations/siem.md) |
| Key management and rotation | Per-issuer keys scoped to kinds; rotation and revocation with re-verification | [intents.md](intents.md) |
| Least privilege and hardening of security tooling | Non-root, read-only container; hashed tokens; separate admin token | [threat-model.md](threat-model.md) |
| Supply-chain integrity: signed code and releases | Signed commits, cosign-signed images, CycloneDX SBOM, SLSA provenance | [repository-settings.md](repository-settings.md) |

## What PayRekha does not cover

PayRekha does not do any of the following. You still need them.

- **Cloud audit logging** (CloudTrail, Azure Activity Log, GCP Audit Logs) and log retention.
- **Cloud control-plane hardening**: IMDS protections, least-privilege roles for instances and functions, security-group egress, serverless execution restrictions.
- **Patching** and vulnerability management of internet-facing systems, including WAF virtual patching.
- **Secret scanning** of your own code and configuration. PayRekha's CI scans only PayRekha.
- **TLS inspection** and network egress control, including default-deny egress policies on your server segments.
- **EDR**, endpoint hardening and malware detection.
- **File-integrity monitoring** on application hosts — web-shell detection and watching web roots / temp dirs for bursts of generated scripts.
- **Detection of AI-driven offensive tooling**, and governance/monitoring of LLM API usage and keys on your infrastructure.
- Identity: MFA, privileged access management, session control.
- Removing or isolating exposed UAT/staging environments. PayRekha only refuses to let them move money.
- **Branch protection, commit signing and code review on your own deployment repositories** (PayRekha applies these to itself).
- **Penetration-test authorization policy** — written approval, defined scope and time windows for testing.
- **Organisation-wide zero-trust, micro-segmentation and east-west traffic inspection.** PayRekha is the zero-trust instantiation for the payout path only.
- **mTLS / signed-request replacement for shared fetcher-pool allow-lists** at vendor endpoints. PayRekha removes IP-based trust from the payout path; it does not itself terminate vendor mTLS connections.
- Restricted indicators of compromise. PayRekha keys on behaviour and does not use CERT-In's restricted indicators.
- Incident reporting to **CERT-In/CSIRT-Fin** within the mandated timelines, and bulk fraudulent-transaction reporting to **I4C / CFCFRMS**.
- **m-of-n multi-approval**: a payout binds exactly one signed intent from one issuer. Multi-approver intents are on the roadmap.
- Geographic / ASN anomaly scoring on token usage — `identity.fingerprint` flags a credential used from a new edge-asserted source; enriching that hint with geo reputation stays SIEM-side.
- Payouts that bypass PayRekha on the network path. Network policy must make it the only route.
