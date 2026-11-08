# RBI IT / cyber-resilience directions (NBFC, bank)

Mapping to the recurring themes across RBI's IT framework, cyber-security
framework, and digital-payment security controls directions. Paraphrased
obligations — cite your regulator's current text in your own filing.

| Theme | PayRekha evidence | Owner |
|---|---|---|
| IT governance — a named control for money movement | PayRekha is a documented payout firewall: every payout gets a verdict bound to a signed business intent (`docs/intents.md`) | product |
| Audit trails — who/what/when on money movement | `decisions.jsonl` JSONL/CEF: per-payout verdict + rule ids + actor; `audit` records for mode/alert/admin changes (`audit-pack/decision-log-schema.md`) | product |
| Fraud-risk controls on payment systems | Full rule corpus: intent binding, velocity budgets, cooling, probe detection, canaries, fraud feed, calendar windows (`docs/advisory-mapping.md`) | product |
| Incident detection & response | HIGH_ALERT state (never expires, authenticated reset), `alert.enter/reset` audit trail, drill suite D1–D9, incident runbook + CERT-In/I4C evidence extraction (`docs/audit-pack/evidence-extraction.md`) | product for detection; **filing is yours** (operator) |
| Business continuity / DR | Single-node snapshot+standby, active-passive promotion (D2), active-active shared-state (ADR 0004), signed snapshot restore (D1/D5), Helm PDB+priorityClass+standby (`deploy/helm/payrekha`) | product ships the mechanisms; **your RTO/RPO choice is yours** |
| Resilience — fail closed on dependency loss | Shared-store outage → DECLINE not allow; `/readyz` drops; `failure-modes.md` | product |
| Access control / least privilege | Role-scoped API keys (`evaluate`/`intents`/`outcomes`/`read`/`admin`), hashed storage, merchant-scoped keys, separate admin token (`audit-pack/access-model.md`) | product |
| Cryptographic controls | Ed25519 intents (RFC 8032), keyed-HMAC beneficiary refs, HMAC-signed snapshots, KMS/HSM signing (`docs/kms.md`) | product |
| Vendor/supply-chain | Signed commits, pinned actions, provenance, cosign, SBOM (`repository-settings.md`) | product (for PayRekha itself) |
| Skilled personnel / training | `docs/playbook-*.md` operator playbooks, kits' first-week runbooks | product provides material; staffing is yours |
| Periodic VAPT / audit | Fuzz suite (`npm run fuzz`), failure-mode matrix, audit pack for your auditor's visit | product provides evidence; the VAPT engagement is yours |
