# Changelog

All notable changes to PayRekha are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may change behaviour, and every release is an alpha or beta.

## [Unreleased]

## [0.1.0-alpha.2] - 2026-11-08

Brand consistency release — no behaviour, wire-format or API changes.

- **`PayRekha` casing everywhere a human reads it** — docs, READMEs, code comments, package descriptions, Grafana dashboard, Helm notes, openapi title, ASCII diagrams. Class names (`Payrekha`, `PayrekhaClient`), Prometheus alert names, the CEF wire format, Sentinel table names, URLs and package identifiers are deliberately unchanged.
- **`People of Product™`** carries the trademark symbol in prose, notices and copyright headers; the CEF vendor field is deliberately unchanged.
- **PyPI workflow + `pypi` environment** for trusted-publishing the Python client; Java namespace ADR 0002 (keep `city.theproduct.payrekha`); npm `latest` now auto-moves only on stable tags.

## [0.1.0-alpha.1] - 2026-11-06

Replay hardening for first-time evaluators, launch-day repo polish, and one rule-semantics refinement. Upgrade from alpha.0 with `npm i @payrekha/replay@alpha` — nothing else changes on the wire.

### Added

- **Replay: penny drops read as verifications, not probes.** Rows tagged `kind=VERIFICATION` now mark their beneficiary as verified in intent-less mode (through the engine's own verified-beneficiary bookkeeping), so later payouts to it are exempt from `probe.micro-then-large` and `beneficiary.cooling` — exactly as they would be under signed intents. The report shows verification counts, and prints a tagging tip when micro payouts exist but none are tagged. On the bundled example export, probe hits drop from 120 to 3.
- **Replay: "Tune before you judge" + suggested thresholds.** Intent-less reports now carry a banner making clear the defaults are illustrative, plus a *suggested starting thresholds* section — p95/p99 of per-source 10-minute counts and sums, amount percentiles, and a `payrekha.json`-shaped config block teams can paste and tighten.
- **`probe.micro-then-large` also exempts payouts bound to a subject the beneficiary was already verified for** — the same exemption `beneficiary.cooling` already had, covering the case where the tagged VERIFICATION row was not the micro still in the ledger window.
- **Repo surface:** 11 GitHub topics for discoverability, Panini Tech attribution in the README, social-preview + topics notes in `docs/repository-settings.md`.

### Fixed

- **Replay `--out` creates missing directories** instead of crashing with a stack trace; unreadable files and malformed CSV/JSON now fail with one-line errors.
- **Flagged-chain ranges could display inverted** (e.g. `18:36 → 18:24` across midnight): steps are explicitly time-sorted and the terminal shows the full end date when it differs from the start date.
- **`SUPPORT.md` reworded to the open-core position** — the core is free forever and protection is never paywalled, but it no longer rules out optional paid operations tooling. Removed the personal UPI ID and corrected the "fail-open" description (shadow mode never blocks; the reference clients hold payouts above ₹50,000 when the gateway is unreachable, configurable).

### Changed

- **Brand spelling is now "PayRekha"** in prose, headings and alt text; package names, the npm scope, CLI names and code identifiers are unchanged.
- **Accent colour aligned to `#FFB23E` marigold** (visual briefs and the playground theme).

### Added (carried since the original alpha.0 tag)

- **Browser playground (`playground/`):** the real engine + rule set bundled for the browser via esbuild (`npm run playground`) — run the full CRAFTY FALCON attack chain in enforce and shadow, evaluate a custom payout, trip the canary, all with zero network calls. Ships a pure-JS `node:crypto` shim (SHA-256/HMAC verified byte-equal against Node) and uses the engine's `hmac-sha256` issuer support — Ed25519 intent signing stays Node/KMS-side by design. Auto-deploys to GitHub Pages via `pages.yml`.
- **Community plumbing:** `.github/FUNDING.yml` + `SUPPORT.md` (UPI-backed, "free forever" pledge, org-sponsorship tiers), structured issue forms (`bug_report`, `rule_report` — the false-positive/missed-detection feedback loop), a PR template mirroring the CI gates, and `scripts/pre-commit.sh` (typecheck+lint before commits land).
- **Repo parity assets:** Prettier config + `npm run format`, `docs/assets/README.md` provenance notes, `docs/assets/visual-briefs.md` specs for the dark/light diagram set, README stats table, playground section, and a People of Product™ footer with social links.
- **Adopter playbooks:** `docs/try-this-weekend.md` — a Friday-to-Sunday hands-on runbook for lender/NBFC teams covering the full replay→shadow→canaries→evidence loop with plug-and-play steps — and three audience playbooks: `docs/playbook-pm.md` (why it matters, effort tiers, objections, what a PM owns), `docs/playbook-ciso.md` (advisory→deployed-control mapping, trust boundaries, compliance evidence, incident playbook, honest limits) and `docs/playbook-cxo.md` (one-paragraph situation, cost/safety table, option comparison, decision asks).
- **`scripts/check-mapping.mjs`:** dry-run the ext_authz field mapping against a real payout sample — shows resolved fields, which required fields are missing, the exact rejection reason when beneficiary formats fail validation, and every leaf path the sample offers so remapping is a 2-minute edit.
- **Crypto beneficiary mapping:** `extAuthz.mapping.beneficiary` gains `address` + `network` sources producing `vda:` refs — an exchange's `{"withdrawal_id","address","network"}` shape now maps through Envoy the same way bank `account+ifsc` does.
- **CI `quickstart` job:** both compose files are config-validated, then the weekend kit is actually brought up (PayRekha + Envoy + Prometheus + Grafana) and `verify-deploy` runs its 12 checks against it — the 30-minute-install promise is now proven on every push.
- **Weekend protection kit (`deploy/quickstart/` + `docs/weekend-kit.md`):** a one-compose shadow-mode stack (PayRekha + Envoy + Prometheus + Grafana) for lenders responding to the CERT-In advisory on a holiday weekend — `failure_mode_allow: true` and shadow pinned so the kit can never block a payout. Ships a pre-armed holiday `calendar.json`, an `env.example` secret checklist, and `npm run verify:deploy` (`scripts/verify-deploy.mjs`): a 12-check post-install proof that ends with a live canary trip → HIGH_ALERT → audited reset.
- **Grafana dashboard (`deploy/grafana/`):** auto-provisioned Prometheus datasource + dashboard — alert-state banner, verdicts vs effective actions (shadow would-stop rate), rule-hit ranking, eval p99, and error panels keyed to `payrekha_*` metrics.
- **SIEM shipper (`deploy/siem/vector.toml`):** decision-log tailer with parse transform and ready sinks for Splunk HEC, Elasticsearch data streams, and Sentinel (DCR) — plus the `PAYREKHA_LOG_FORMAT=cef` alternative.

- **Go client (`clients/go`):** standard library only, with Ed25519/HMAC intent signing that matches the shared test vector, and the same fail mode as the Java and Python clients.
- **Role-scoped API keys:** `PAYREKHA_API_KEYS` entries accept `id:prod|nonprod[:role+role]:token` with roles `evaluate`, `outcomes`, `intents`, `read`. Keys without a role list keep access to everything.
- **`firewall.maxTimestampSkewMs`:** a caller's claimed timestamp outside the bound is evaluated at firewall time with a degraded `time.skew` REVIEW — protecting in-process embedding and trusted-caller paths.
- **Audit entries in the decision log:** admin actions and denied/accepted outcome reports (`outcome.denied`, `outcome.<outcome>`) are written as `type:"audit"` records alongside verdicts when `PAYREKHA_DECISION_LOG` is set.
- **Runtime issuer-key revocation:** `DELETE /v1/issuers/:keyId` (admin, reason required) revokes a signing key without a redeploy — every intent it signed fails verification from the next evaluation, and the revocation persists in the state snapshot.
- **Intent-verification budget:** `intentVerificationsPerMinute` (default 5000) bounds how many signature verifications one key can spend on `POST /v1/intents` per minute — a stolen `intents` key cannot stall the event loop with Ed25519 spam. Over-budget calls get 429.
- **Snapshot integrity (`PAYREKHA_STATE_KEY`):** when set, state snapshots are stored as `{v, d, m}` envelopes MAC'd with HMAC-SHA256 over the canonical JSON — so integrity holds across Postgres JSONB key reordering. Tampered or wrong-key snapshots fail closed at load. Applies to both the file and Postgres stores. Deployments without the key keep the previous unsigned format; once a key is set, unsigned snapshots are refused.
- **Launch artefacts:** `docs/production-checklist.md` and `docs/runbook.md`; Prometheus alerts for `payrekha_ready == 0`, state-save and decision-log errors; numeric env vars (`PORT`, `PAYREKHA_STATE_*_MS`) fail loud at boot instead of accepting `NaN`.
- **Supply chain:** `CODEOWNERS` and `.github/dependabot.yml` (npm, actions, Docker, Go, pip) — both were documented but missing. Every `uses:` action is pinned to a commit SHA with the tag kept as a comment; gitleaks is verified against a pinned SHA256 before running; CI now enforces a coverage floor (85/75/80).

### Changed

- **Caller timestamps are no longer the decision clock.** The gateway stamps server time on `/v1/evaluate` and `ext_authz` payouts and keeps the caller's value as `clientTimestampMs` evidence in the decision record. This closes timestamp spoofing of intent windows, velocity budgets, cooling periods and the block-burst counter. Opt back in per trusted caller with `gateway.trustClientTimestamp` / `extAuthz.trustClientTimestamp`.
- **`POST /v1/outcomes` is bound to the evaluating key.** `failed`/`reversed` refund an intent use, so only the key whose evaluation consumed it may report — reports from other keys return `known:false` and are audited.
- **Deduped verdicts now follow the mode in force.** A retry returns the cached rule outcome (idempotent) but recomputes `mode`/`effectiveAction` — a `shadow → enforce` flip no longer serves ALLOW for a verdict that is really a BLOCK.
- **A settled payout keeps its payoutId bound.** `settle` now tombstones the reservation instead of deleting it, so the payoutId cannot be rebound to a fresh intent after dedupe eviction or a restart. Settled is final and idempotent; a later `failed` on a settled payout is denied and audited. Unkeyed in-process callers can no longer touch a bound reservation.
- **`outcome.settled` reports are audited** alongside denied/released.
- **ext_authz hardening:** boot refuses `extAuthz.mapping.sourceKeyId` sourced from `body.`/`query.` (caller-named identity) and warns when it comes from a header the proxy must assert, or when the check endpoint has no `x-payrekha-key` configured. The shipped envoy.yaml now asserts `x-payrekha-origin` inside `authorization_request.headers_to_add` — route-level headers never reach the check request.
- **HTTP hygiene:** malformed percent-encoding on `/v1/issuers/:keyId` is a 400 (was 500); the server sets `headersTimeout`/`requestTimeout` (15s/30s) instead of Node defaults.
- **Decision-engine hardening (deep-dive pass):** per-merchant velocity rings now live in a separate bounded map from per-key rings — `merchantId` is caller input, and churned merchantIds can no longer evict a caller's (or a victim's) velocity budget. `gateway.merchantScope` pins an API key to allowed merchantIds (403 otherwise; `PA_SETTLEMENT` without one is refused under a scoped key). Firewall config is validated at construction — a typo'd `modeByKind`/`requireIntent` kind, an unknown mode/alert-state or a non-finite multiplier now fails boot instead of silently disabling a control. An active beneficiary refreshes its ledger recency on every payout (hot beneficiaries could previously be evicted mid-activity and get spurious cooling REVIEWs).
- **State/persistence fixes (deep-dive pass):** the `highAlertOnBlocks` burst counter is now part of the snapshot — a restart mid-burst no longer silently zeroes it. `PostgresStateStore` no longer caches a failed `CREATE TABLE` promise: a transient init failure at boot would previously keep the store broken forever (gateway permanently unready); retries now reach Postgres.
- **HTTP/observability fixes (deep-dive pass):** requests carrying `Content-Encoding` (e.g. gzip) now get a clean 415 instead of a degraded REVIEW on an unparseable body. Decision-log stream failures (disk full etc.) now increment `payrekha_decision_log_errors_total` and are logged — previously only synchronous write throws counted, so the alert could not fire on the most common failure mode.
- **Industry-parity pass — upstream signal ingestion + analyst surface.** New `external` rule: payouts may carry an advisory `riskScore` (0..1) / `externalVerdict` / `externalSource` from a fraud vendor or the caller's own scorer; configurable `rules.external` bands turn them into REVIEW/BLOCK hits. Strictly one-directional — signals can only make a verdict stricter, so an untrusted caller minimizing its own score evades nothing real. `extAuthz.mapping` gains `riskScore`/`externalVerdict`/`externalSource` so a proxy can assert them (e.g. a Feedzai sidecar's header). Verdicts now carry a deterministic `riskScore` (strongest-hit normalized + degraded bump) for triage sorting. New read-role analyst API: `GET /v1/decisions` (bounded ring, `?verdict=&payoutId=&intentId=&limit=` filters), `GET /v1/audit`, `GET /v1/intents/{id}` (signature never served) — the documented surface consoles and triage tools build on.
- **Drill pack + load harness (`docs/drills.md`, `scripts/`):** `npm run drill:crash` is executable evidence for the kill-mid-save failure mode — it SIGKILLs a real gateway mid-save-cycle and asserts the signed snapshot restores HIGH_ALERT (passed on this machine). `npm run loadcheck` answers the deferred serialization question with data: ~64 µs eval p99 at 100k-beneficiary state, ~205 ms HMAC-dominated snapshot stall at ~20 MB — documented in `docs/runbook.md` with the >20 MB trigger for async serialization.
- **ext_authz hard fail + webhook-drop alert (deep-dive pass):** configuring `extAuthz` without a key now **refuses boot** — `createGateway` and `bootFromEnv` both throw — unless `extAuthz.allowInsecure: true` is set explicitly (isolated networks only). An unauthenticated check path can never appear by omission again. New `PayrekhaWebhookDropped` Prometheus rule: the metric existed but a saturated webhook queue previously dropped BLOCK notifications silently.
- **Managed intents — the lowest-effort adoption tier (`docs/adoption.md`).** `POST /v1/intents/mint` builds, signs and registers an intent with a gateway-held key (`PAYREKHA_MINT_KEY_ID` + `PAYREKHA_MINT_KEY`, ed25519 only; `gateway.mint.defaultTtlMs`/`maxTtlMs` bound lifetime, defaults 5 min/24 h). An adopter's system of record needs one extra HTTP call — no canonical JSON, no key management, raw beneficiary fields hashed at entry exactly like `/v1/evaluate`. Idempotent by construction (identical fields derive the same `intentId`; caller-provided ids honoured), every mint audited as `intent.minted`, `mint` is its own API role (a mint key cannot register foreign-signed intents and vice versa), and boot fails if the configured key does not verify. `examples/intent-bridge.mjs` is a dependency-free webhook→mint reference connector for zero-LOS-code adoption.
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

[Unreleased]: https://github.com/peopleofproduct/payrekha/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/peopleofproduct/payrekha/compare/v0.1.0-alpha.0...v0.1.0-alpha.1
[0.1.0-alpha.0]: https://github.com/peopleofproduct/payrekha/releases/tag/v0.1.0-alpha.0
