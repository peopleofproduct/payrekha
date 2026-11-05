# Changelog

All notable changes to Payrekha are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may change behaviour, and every release is an alpha or beta.

## [Unreleased]

## [0.1.0-alpha.0] - 2026-11-06

First public alpha. The default thresholds are illustrative and have not been tuned on production data, so run in shadow mode first.

### Added

- **Core (`@payrekha/core`):** a generic rule engine with retry dedupe, degraded `REVIEW` for malformed input, ordered rules with first-`BLOCK` short-circuit, isolation of rules that throw, and state export and restore.
- **Signed intents:** `LOAN_DISBURSAL`, `PA_SETTLEMENT`, `REFUND`, `VDA_WITHDRAWAL`, `VENDOR_PAYOUT` and `VERIFICATION`. Ed25519 by default, HMAC-SHA256 optional. Intents use canonical JSON and support key rotation and revocation.
- **Modes and alerts:** `shadow` (the default), `advise` and `enforce`, settable per payout kind. `HOLIDAY` is driven by the calendar. `HIGH_ALERT` is raised by a canary hit or a burst of blocks, and only an authenticated admin can reset it.
- **Privacy:** beneficiaries are stored as keyed HMAC hashes (`hb1_…`). Raw account numbers, VPAs and mobiles are rejected.
- **Rules (`@payrekha/rules`):** intent binding (missing, bad signature, kind mismatch, expired, reused, amount exceeded, beneficiary mismatch), beneficiary cooling, `probe.micro-then-large`, per-API-key outflow velocity, amount band, non-prod origin, canaries, client attestation, calendar window, fraud feed, settlement account changes and over-capture.
- **Gateway (`@payrekha/gateway`):**
  - HTTP API, Envoy `ext_authz` adapter with declarative field mapping, and a JSONL/CEF decision log.
  - Prometheus metrics and signed SOAR webhooks.
  - Fail-closed startup: requests get 503 until the saved state has been read.
- **State:** a file store, and `@payrekha/store-postgres` with optimistic versioning. A second writer is detected and stops serving instead of overwriting state. This supports one active gateway with a standby, not several active copies.
- **Replay (`@payrekha/replay`):** replays a ledger CSV or JSON export with column mapping, with or without intents. Writes a self-contained `report.html` and `report.json`, including a false-positive review list.
- **Clients:** Java (JDK only) and Python clients that sign byte-identical intents, with the fail mode `hold-above:5000000`.
- **Deploy:**
  - Hardened Docker image: non-root, read-only filesystem.
  - Envoy compose stack with Prometheus alerts.
  - Helm chart with a NetworkPolicy, secrets supplied only from an existing Kubernetes Secret, and a guard against two copies writing the same state file.
- **Demos:** `npm run demo` (the CRAFTY FALCON chain) and `npm run demo:live` (live through Envoy), plus the [demo runbook](docs/demo.md).
- **Supply chain:** npm provenance, a keyless Cosign image signature, a CycloneDX SBOM, SLSA build provenance once the repository is public, and gitleaks scanning across the full history.

[Unreleased]: https://github.com/peopleofproduct/payrekha/compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: https://github.com/peopleofproduct/payrekha/releases/tag/v0.1.0-alpha.0
