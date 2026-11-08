# Audit pack — hand this directory to your auditor

This directory is designed to answer a security auditor's standard
checklist **without an engineer in the room**. Every claim below cites a
document or a code path; where a control is the operator's job (not
PayRekha's code) it says so plainly — an honest boundary reads better in
an audit than a stretched claim.

## The checklist

| Auditor asks | Answer lives in |
|---|---|
| What does this system do, what is its threat model? | `../threat-model.md` — assumptions, attacker capabilities, hardening |
| Which external obligations does it address? | `control-matrix.md` — CERT-In CIAD-2026-0058 rows → control → code → test |
| What fails how? | `../failure-modes.md` — every failure mode → metric → drill |
| Who can call what? | `access-model.md` — API-key roles, admin auth, origin pinning |
| What does the audit trail look like, and can it be tampered with? | `decision-log-schema.md` — record schema, integrity story, retention guidance |
| Prove failover/incident controls actually work | `../drills.md` + `drill-evidence-template.md` — run each drill, attach results |
| How is the software itself built/released? | `../repository-settings.md` — signed commits, pinned CI, provenance, cosign/SBOM |
| Where do keys live? | `../kms.md` — HSM/KMS signing options; issuer key model |
| Capacity/scale evidence? | `../capacity-envelope.md` — measured envelope, sharding trigger |
| What must WE (the deployer) still do? | `control-matrix.md` §"operator responsibilities" — the declared exclusion list |
| How do we extract evidence for a CERT-In/I4C report? | `../runbook.md` incident section + `evidence-extraction.md` — copy-paste jq |

## The two-minute orientation for an auditor

1. PayRekha is a **payout firewall**: it sits between a payout API and the
   rail, gives every payout a verdict (`ALLOW`/`REVIEW`/`BLOCK`), and
   binds payouts to **pre-signed intents** from an independent system of
   record.
2. It is **not** an EDR, cloud control plane, or zero-trust platform —
   `control-matrix.md` separates product controls from operator/cloud
   responsibilities explicitly.
3. Its design rule: **authorisation failures fail closed**; side-effect
   failures (logging, webhooks) never block the verdict path —
   `../failure-modes.md` is the exhaustive table.
4. Beneficiaries are **keyed-HMAC references (`hb1_…`)** everywhere —
   no raw account/VPA/mobile is stored or logged (DPDP minimisation);
   `decision-log-schema.md` has the field-level proof.
