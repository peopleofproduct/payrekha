# Changelog

All notable changes to Payrekha are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may change behaviour, and every release is an alpha or beta.

## [Unreleased]

### Added

- **Go client (`clients/go`):** standard library only, with Ed25519/HMAC intent signing that matches the shared test vector, and the same fail mode as the Java and Python clients.
- **Role-scoped API keys:** `PAYREKHA_API_KEYS` entries accept `id:prod|nonprod[:role+role]:token` with roles `evaluate`, `outcomes`, `intents`, `read`. Keys without a role list keep access to everything.
- **`firewall.maxTimestampSkewMs`:** a caller's claimed timestamp outside the bound is evaluated at firewall time with a degraded `time.skew` REVIEW — protecting in-process embedding and trusted-caller paths.
- **Audit entries in the decision log:** admin actions and denied/accepted outcome reports (`outcome.denied`, `outcome.<outcome>`) are written as `type:"audit"` records alongside verdicts when `PAYREKHA_DECISION_LOG` is set.

### Changed

- **Caller timestamps are no longer the decision clock.** The gateway stamps server time on `/v1/evaluate` and `ext_authz` payouts and keeps the caller's value as `clientTimestampMs` evidence in the decision record. This closes timestamp spoofing of intent windows, velocity budgets, cooling periods and the block-burst counter. Opt back in per trusted caller with `gateway.trustClientTimestamp` / `extAuthz.trustClientTimestamp`.
- **`POST /v1/outcomes` is bound to the evaluating key.** `failed`/`reversed` refund an intent use, so only the key whose evaluation consumed it may report — reports from other keys return `known:false` and are audited.
- **Intent reservations record the evaluating `sourceKeyId`**, and dedupe is scoped per key so one key cannot preload another key's payout ids.
- **A `payoutId` is bound to one intent for life.** A retry after restart correctly sees its own reservation instead of `intent.reused`, while replaying a taken `payoutId` under a different intent is blocked as reuse — previously it evaluated `ok` and was never consumed.
- **Demo Envoy config:** `x-client-id` is now asserted by Envoy (`headers_to_add`) instead of forwarded from the client — a caller must never name its own source key.
- **OpenAPI:** corrected drift — `channel` enum (`INTERNAL`, not `OTHER`), `/v1/intents` status codes (201/207/422), `/v1/outcomes` outcome values and binding semantics, `/v1/canaries` 201, `/metrics` requires a key.

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
