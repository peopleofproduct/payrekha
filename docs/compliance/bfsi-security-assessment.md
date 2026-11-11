# PayRekha — BFSI security & compliance assessment

**Document status:** internal audit record for BFSI adoption readiness. Prepared for security review by regulated entities (NBFCs, banks, payment aggregators, lenders, VDA exchanges) evaluating PayRekha for test-environment and subsequent production deployment.

**Version assessed:** `0.1.0-alpha.2` (worktree `ca19887`, plus the hardening pass recorded in §6 — F-02/F-05/F-06/F-13 fixes and the `PAYREKHA_TLS_*` listener) · **Assessment date:** 2026-11-11 · **Method:** full manual code review of the money path, state path, admin path and supply chain, plus execution of the test suite (163 tests, all passing).

> This document is honest evidence, not a certification. It records what the code actually does — including the findings that require operator action — so your security team can verify each claim against the cited source.

---

## 1. Executive summary

PayRekha is an in-process payout firewall: every payout must present a **signed business intent** issued by an independent system of record, or it does not leave. The architecture's core security claim — _a stolen payout credential alone cannot move money_ — holds up under code review, because:

- Intent verification is **Ed25519 with domain separation and a fail-closed keyring**; PayRekha stores only public keys, so no PayRekha-side compromise mints intents.
- Every failure path reviewed **fails toward DECLINE or degraded REVIEW — never toward an unauthenticated ALLOW**.
- The product's data model **cannot hold raw PII**: beneficiaries exist only as operator-keyed HMAC refs (`hb1_…`).
- The supply chain is minimal by construction: **zero runtime dependencies** in `core` and `rules`, enforced in CI.

The assessment found **no critical or high-severity defects**. Two medium findings concern deployment posture (TLS termination; connector image dependency pinning) and a set of low/informational findings describe optional controls that BFSI adopters should treat as **required** (`PAYREKHA_STATE_KEY`, demo-config isolation, webhook HTTPS). All are detailed with evidence in §6.

**Bottom line:** suitable for a BFSI test environment today under the deployment requirements in §7, and for production once the staged-adoption ramp in §8 completes — which is exactly the adoption model the product is designed around (shadow → advise → enforce, each reversible).

## 2. What PayRekha is, and where its boundary sits

```
 system of record          payout path                       money rails
 (LOS/LMS/settlement)  ┌─────────────────────────┐
  signs intents  ───►  │ API caller ─► gateway ─►│─► payout API ─► bank/PA/UPI
  (Ed25519, KMS/HSM)   │   PayRekha evaluates    │
                       └─────────────────────────┘
```

- **Trust anchor #1:** the issuer signing key, held by the system of record — ideally KMS/HSM (`docs/kms.md` adapters for AWS KMS, GCP Cloud KMS, PKCS#11). PayRekha holds public keys only.
- **Trust anchor #2 (active-active only):** the shared-state Postgres — control-row write access can set mode/revocations on every replica (`applyControl`). It sits inside the operator's perimeter and must be scoped accordingly (§7).
- **Out of scope by design:** anything that bypasses PayRekha on the network path, endpoint/EDR, patching, MFA, TLS termination itself, CERT-In/I4C reporting. `docs/advisory-mapping.md` lists these explicitly — the product names its boundary rather than implying coverage.

## 3. Review method

| Area                       | Artifacts reviewed                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Crypto & intents           | `packages/core/src/intent.ts`, `canonical.ts`, `hash.ts`, `registry.ts`                                                                  |
| Engine & firewall          | `firewall.ts`, `engine.ts`, `ledger.ts`, `lru.ts`, `ring.ts`, `calendar.ts`, `ist.ts`                                                    |
| State integrity            | `snapshot.ts`, `serialize.ts`, `store.ts`, `shared.ts`, `store-postgres/src/*`                                                           |
| Network surface            | `gateway/src/server.ts`, `config.ts`, `mapping.ts`, `log.ts`, `webhook.ts`, `shared.ts`, `metrics.ts`                                    |
| Rules (18 advisory-mapped) | `packages/rules/src/*`                                                                                                                   |
| Connectors                 | `connectors/*.mjs`, `connectors/lib/*`, fieldmaps                                                                                        |
| Deployment                 | `deploy/Dockerfile`, `docker-compose.yml`, `envoy`, `helm/payrekha`, `terraform/ecs`, `quickstart`                                       |
| Supply chain               | root/package manifests, `tools/check-zero-deps.mjs`, `.github/workflows/*`, `dependabot.yml`, `.gitleaksignore`, `scripts/pre-commit.sh` |
| Verification               | `npm test` (163 pass), `npm audit` (0 vulnerabilities), gitleaks CI config                                                               |

## 4. Security architecture — what the code does

### 4.1 Cryptography

| Property                                                                                                                                                                                        | Evidence                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Intent signatures: Ed25519 (RFC 8032); HMAC-SHA256 offered but warned against at boot                                                                                                           | `intent.ts` — `signIntent`, `Keyring.add` enforces ≥32-char HMAC secrets; `config.ts` logs a warning per HMAC issuer |
| Domain separation: `payrekha-intent-v1\n` prefix means an intent signature cannot be replayed as any other message type                                                                         | `intent.ts:19`                                                                                                       |
| Canonical JSON: sorted keys, safe-integers only (floats rejected so Java/Python signers can't disagree), `undefined` dropped, **depth capped at 64** (stack-overflow DoS fix — fuzz finding B7) | `canonical.ts`                                                                                                       |
| Constant-time comparisons for HMAC intents, API tokens, admin token, snapshot MACs                                                                                                              | `timingSafeEqual` in `intent.ts`, `firewall.ts:627`, `server.ts:158`, `snapshot.ts:42`                               |
| Ed25519 signature must be exactly 64 bytes before `verify` is attempted                                                                                                                         | `intent.ts:171`                                                                                                      |
| Beneficiary identifiers: keyed HMAC-SHA256 with type-namespaced preimages (`acct:`/`vpa:`/`mob:`/`vda:`), `hb1_` prefix; key ≥16 bytes enforced                                                 | `hash.ts:22–53`                                                                                                      |
| Snapshot integrity: HMAC-SHA256 over canonical JSON under tag `payrekha-state-v1\n`, with previous-key rotation window                                                                          | `snapshot.ts`, `serialize.ts`                                                                                        |
| Webhook events: `sha256=HMAC(timestamp.body)` — receivers verify `x-payrekha-signature`                                                                                                         | `webhook.ts:20`                                                                                                      |
| Mint-key boot probe: a configured `PAYREKHA_MINT_KEY` that doesn't verify against its issuer **fails startup**, not the first mint                                                              | `config.ts:246–260`                                                                                                  |

### 4.2 Authorization model — the intent binding

- **Keys are scoped to issuers, kinds, validity windows** (`IssuerKey.kinds`, `notAfterMs`, `revoked`); verification fails closed through six distinct reasons (`intent.ts:103`).
- **A payout binds all of:** kind, amount ceiling (`maxAmountPaise`, cumulative across uses), beneficiary ref, validity window, use count, and — for life — its `payoutId` (`registry.ts:189–225`). A `payoutId` settled once can never rebind a different intent — the tombstone survives restarts and dedupe eviction.
- **m-of-n approvals** require distinct issuers per cited intent and support an `approverIssuers` allowlist pointing at e.g. a risk-desk keyring (`registry.ts:235–273`, ADR 0003).
- **Rejected intents are tombstoned**, so a payout citing a bad-signature intent surfaces `intent.bad-signature` (actionable) rather than `intent.missing` (`registry.ts:154–157`).
- **Reservation release/settle is bound to the consuming `sourceKeyId`** — a stolen key cannot free another caller's intents; denials are audited (`registry.ts:299–328`, `firewall.ts:437–441`).
- **Keyring changes re-verify cached intents** via a generation counter; revocations are carried in snapshots — a restart cannot resurrect a burned key (`registry.ts:195–199`, `firewall.ts:728`).

### 4.3 API authentication & authorization

- Bearer tokens are **stored only as SHA-256 hashes** — raw tokens never persist (`server.ts:21`, `config.ts:80`).
- **Role-scoped keys:** `evaluate`, `intents`, `outcomes`, `read`, `mint` — boot warns when one key holds both mint and evaluate/intents (`server.ts:14`, `config.ts:263–266`).
- **`merchantIds` scoping** pins a key to named merchants — a stolen settlement key cannot impersonate another merchant (403) (`server.ts:273–277`).
- **Caller-asserted identity is structurally impossible:** `sourceKeyId` and `origin` are overwritten from the authenticated key, `sourceHint` is deleted then re-asserted from the socket peer, and `timestampMs` is stamped server-side — the caller's value is kept only as `clientTimestampMs` evidence (`server.ts:262–284`).
- **ext_authz:** refuses to boot without a shared key unless `allowInsecure: true` is set explicitly; `sourceKeyId` mapping from body/query is rejected at boot — a caller can never name its own key (`server.ts:208–209`, `config.ts:212–218`).
- **Admin plane is separate:** `PUT /v1/state`, issuer revocation and canary writes require the admin bearer _and_ a non-empty `reason` that lands in the audit trail; every denial is also audited (`server.ts:464–468`, `firewall.ts:626–637`).
- **Raising HIGH_ALERT needs no credential** — anyone may pull the alarm; only lowering it is gated. Deliberate, and documented (`firewall.ts:502–505`).

### 4.4 Input validation & injection

- Every request field is shape-checked (enums, integer ranges, length caps: payoutId ≤128, signature ≤512, approvalIds ≤8); **messages name the field, never echo its value** — no PII in errors (`firewall.ts:202–225`).
- Malformed input → **degraded REVIEW, never ALLOW** (`engine.ts:82–85`); a throwing rule is isolated into `ruleErrors` (→ degraded) and the loop continues (`engine.ts:86–110`).
- Raw-looking beneficiary refs (`@`, 6–20 digits, IFSC+digits) are **refused at the shape check and stripped from logs** (`hash.ts:63–69`, `log.ts:39–63`).
- Postgres: all values parameterized; table names validated against `^[a-z_][a-z0-9_]{0,62}$` before interpolation — no SQL injection path (`store-postgres/src/index.ts:28`, `shared.ts:15`).
- `x-request-id` is regex-validated before echo; `content-encoding` other than `identity` is rejected (no zip-bomb surface); request paths route on exact matches (`server.ts:159–182`).

### 4.5 Denial-of-service resilience

| Bound                   | Value                                                                                                                   | Where                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Request body            | 64 KB default                                                                                                           | `server.ts:212`                           |
| Header/request timeouts | 15 s / 30 s                                                                                                             | `server.ts:570`                           |
| Intent verifications    | 5 000/key/min — Ed25519 verify is the expensive unit                                                                    | `server.ts:315–323`                       |
| Managed mints           | 60/key/min, charged before body read                                                                                    | `server.ts:345–353`                       |
| Canonical JSON depth    | 64 levels                                                                                                               | `canonical.ts:18`                         |
| All runtime state       | bounded: intents 1M LRU, reservations 1M, beneficiaries 1M, merchants 200k, dedupe 10k, audit ring 1k, decision ring 1k | `registry.ts`, `ledger.ts`, `firewall.ts` |
| Velocity ring buffers   | capped per budget (≤4 096 slots)                                                                                        | `behaviour.ts:119`                        |
| Webhook queue           | 1 000, drops counted                                                                                                    | `webhook.ts:41`                           |
| PG pools                | max 2 (state) / 4 (shared)                                                                                              | `store-postgres`                          |

### 4.6 Data protection & privacy (DPDP Act 2023)

The minimisation posture is structural, not configurational:

- **No field exists** in the data model for a name, PAN, account number, VPA, or mobile — beneficiaries are `hb1_` refs; `hashAtEntry` deletes raw fields _before_ evaluation even when no hash key is configured (`server.ts:185–205`).
- The decision log **physically cannot carry a raw ref**: `decisionRecord`'s `safe()` drops any `beneficiaryRef` not starting `hb1_` (`log.ts:39,62`). CI proves it — the secrets job asserts no raw identifier appears in a live decision log (`ci.yml` "No raw beneficiary identifiers").
- A stolen `decisions.jsonl` or snapshot leaks `hb1_` refs + amounts — reversal needs the operator's `PAYREKHA_HASH_KEY` too. Residual identifiers (`payoutId`, `merchantId`, `sourceHint`/IPs) are honestly declared in `docs/compliance/dpdp.md`.
- **No telemetry, no phone-home** — core/rules have no network imports, CI-enforced (`tools/check-zero-deps.mjs`); the only outbound call is the operator-configured webhook.

### 4.7 State integrity & anti-rollback

- Snapshots are **HMAC-signed when `PAYREKHA_STATE_KEY` is set**; enabling a key on an unsigned file refuses to load, and vice versa — no silent unsigned→signed or signed→unsigned transitions (`snapshot.ts:30–45`).
- File writes are atomic (tmp + rename, mode 0600); Postgres writes are **compare-and-set on a version counter** — a second writer gets `StaleStateError` and fences itself unready (`store.ts:46–49`, `store-postgres/index.ts:101–119`).
- **HIGH_ALERT survives restarts** — a reboot is not a way to clear it; the block-burst window state is also persisted (`firewall.ts:709,730`).
- **Mode is never restored from a snapshot** — config is the source of truth, so a tampered state file cannot flip `enforce` back to `shadow` (`firewall.ts:714–718`).
- Restored intents are **re-verified against the keyring on load** — a crafted snapshot cannot inject valid intents (`registry.ts:343`).

### 4.8 Audit logging & monitoring

- Append-only decision log (JSONL or **ArcSight CEF:0** for QRadar/ArcSight): per-payout verdict, rule ids, evidence, actor key, `decisionId`, `deduped` flag (`log.ts`).
- Admin actions, denied outcome reports, alert transitions and key revocations are `type:"audit"` records in the same stream (`log.ts:70–78`, `config.ts:191–192`).
- In-memory audit ring (last 1 000) backs `GET /v1/audit`; decision ring backs `GET /v1/decisions` — both `read`-role gated.
- Prometheus `/metrics` (read-role): evaluations, verdicts, rule hits/errors, dedupe, shared-commit latency/conflicts/fail-closed counters, state-save wall time (`metrics.ts`, `server.ts:297`).
- Webhooks: HMAC-signed, bounded queue, retries with backoff, **fire-and-forget — a SIEM outage never delays a verdict** (`webhook.ts`).

### 4.9 Failure behaviour — the fail-closed analysis

Every failure path reviewed fails toward denial or degraded evidence:

| Failure                            | Behaviour                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Malformed payout                   | degraded REVIEW (never ALLOW)                                                                                                   |
| A rule throws                      | isolated → `ruleErrors`, `degraded: true`; never ALLOW                                                                          |
| Shared store down (active-active)  | enforce-mode → `store.commit-failed` BLOCK/DECLINE; `/readyz` unready. **No allow-on-outage path exists** (`shared.ts:266–274`) |
| Snapshot unreadable at boot        | gateway stays 503 `not ready`, retries — a hidden HIGH_ALERT is never assumed away (`config.ts:299–311`)                        |
| Second writer on one store         | CAS `StaleStateError` → self-fences unready (`server.ts:608–612`)                                                               |
| Caller clock skew                  | evaluated at firewall time + `time.skew` REVIEW evidence (`firewall.ts:311–349`)                                                |
| ext_authz without key              | boot refusal unless `allowInsecure: true` explicitly set (`server.ts:208`)                                                      |
| Envoy/PayRekha unreachable at edge | `failure_mode_allow: false` in the prod reference → 403 at proxy (`deploy/envoy/envoy.yaml`)                                    |
| Webhook/decision-log failure       | counted, never on the verdict path (`webhook.ts`, `log.ts:136–144`)                                                             |

The full matrix with drills lives in `docs/failure-modes.md` / `docs/drills.md` (D1 kill -9, D2 promotion, D3 fencing, D4 key compromise, D6 alert reset, D8 active-active invariants — the last two are scripted, not manual).

### 4.10 Supply chain

- **Zero runtime dependencies** in `@payrekha/core`; `rules` depends only on core — CI-verified, including a **network-import scan** (`tools/check-zero-deps.mjs`, `ci.yml`). Total runtime footprint: `pg` (store-postgres only).
- All GitHub Actions **pinned to commit SHA** with version comments; Dependabot updates pins (`release.yml`, `ci.yml`).
- **Dependabot PRs may only touch manifests** — a bot-authored diff outside allowlisted paths fails CI (sandbox-poisoning guard, `ci.yml:15–31`).
- **gitleaks full-history scan** in CI; the gitleaks binary itself is fetched with a pinned sha256 (`ci.yml:191–202`). `.gitleaksignore` exceptions are annotated (test keypairs, planted CI dummies).
- Releases: **cosign keyless image signing** (GitHub OIDC), **CycloneDX SBOM** attached to the release, **SLSA build provenance**, `npm publish --provenance`, PyPI OIDC trusted publishing — verification commands in `docs/repository-settings.md` (`release.yml`).
- `npm ci --ignore-scripts` in the image build; multi-stage; `npm audit` today: **0 vulnerabilities**.
- Node engine pinned `>=22`; TypeScript strict; coverage gates 85/75/80 in CI.

### 4.11 Deployment hardening

- Container: **non-root (`USER node`), read-only root FS, `cap_drop: ALL`, `no-new-privileges`**; Helm adds `seccompProfile: RuntimeDefault`, `runAsNonRoot`, `runAsUser: 1000`. CI asserts non-root + read-only + `/readyz` end-to-end (`deploy/Dockerfile`, `_helpers.tpl:56–85`, `ci.yml:134–142`).
- Helm **default-deny egress** NetworkPolicy (DNS only + explicit Postgres CIDR); topology is template-validated — `replicaCount>1` under `single` fails `helm template` (`networkpolicy.yaml`, `deployment.yaml:3`).
- Secrets never in `values.yaml`/image — `existingSecret` or External Secrets Operator; ECS module takes Secrets Manager ARNs (`values.yaml:27–41`, `terraform/ecs/main.tf`).
- The listener can serve **TLS or mTLS itself** — `PAYREKHA_TLS_*` env vars point at secret-mounted PEMs; `clientAuth=required` rejects certless clients at the handshake; TLS material is never logged (`server.ts:592–633`, `config.ts:285–306`).
- `bin/payrekha.mjs init` writes generated secrets **0600**.

## 5. Regulatory mapping

Detailed per-regime pages already exist in `docs/compliance/`; this section consolidates the BFSI picture.

### 5.1 CERT-In CIAD-2026-0058 (the originating advisory)

Every payout-relevant recommended action maps to a shipped, tested control — the full matrix is `docs/audit-pack/control-matrix.md` and the line-by-line review is `docs/advisory-review-ciad-2026-0058.md`. Highlights: signed intents (valid-credential abuse), beneficiary/amount/window binding (tamper/replay), `probe.micro-then-large`, `origin.nonprod` (UAT→prod pivot), `calendar.window` HOLIDAY multipliers (holiday-timed attacks), canaries (deception), non-expiring HIGH_ALERT (assume-persistence), m-of-n distinct-issuer approvals (multi-sig withdrawals).

### 5.2 RBI cyber-resilience / IT governance themes

Named controls for money movement (the firewall itself), audit trails (decision log + audit records), fraud-risk controls (18-rule corpus), incident detection (HIGH_ALERT + drills), BCP/DR (snapshot+standby, active-active, CAS fencing), fail-closed resilience, least privilege (role-scoped keys), crypto controls, and supply-chain evidence — table in `docs/compliance/rbi-it.md`. Operator-side obligations (VAPT engagement, staffing, regulator filings) are named, not claimed.

### 5.3 RBI PA/PG + settlement reconciliation

`settlement.over-captured` (settle only what was reconciled), `settlement.account-changed` (24h maker-checker on destination change), per-merchant key scoping and velocity budgets — `docs/compliance/rbi-pa-pg.md`. Escrow/nodal-account discipline and merchant KYC remain operator obligations.

### 5.4 DPDP Act 2023

Minimisation is structural (§4.6); the honest boundary — `payoutId`/`merchantId`/IP hints are still identifiers — is declared. Breach impact of a stolen log/snapshot is bounded by the keyed hash (`docs/compliance/dpdp.md`).

### 5.5 PCI-DSS

Out of PCI scope by data flow — no PAN/CVV/track field exists — so PayRekha shrinks rather than joins the CDE, and can be presented to a QSA as a compensating-control candidate on the payout authorization boundary (`docs/compliance/pci-dss.md`).

### 5.6 ISO/IEC 27001:2022 Annex A (product-side evidence)

| Annex A control                             | Evidence                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| A.8.2 Privileged access rights              | Role-scoped API keys, separate admin token, merchant scoping                    |
| A.8.5 Secure authentication                 | Hashed bearer tokens, constant-time compare                                     |
| A.8.15/16 Logging & monitoring              | Decision log, audit records, Prometheus, canaries, HIGH_ALERT                   |
| A.8.20 Network security                     | Helm default-deny egress; edge auth via ext_authz                               |
| A.8.24 Cryptography                         | Ed25519, HMAC-SHA256, domain separation, KMS/HSM path                           |
| A.8.25/26 Secure development & app security | Shape checks, fail-closed defaults, zero-dep core                               |
| A.8.29 Security testing                     | 163-test suite, coverage gates, fuzz, D1–D9 drills, verify-deploy               |
| A.8.31 Dev/test/prod separation             | `origin` bound to the key; `origin.nonprod` BLOCK; `keyOrigins` drift detection |
| A.8.32 Change management                    | Mode/alert/key changes are audited records with actor+reason                    |

### 5.7 SOC 2 Trust Services Criteria (product-side)

CC6.1–6.3 (logical access, prior auth, removal), CC6.6 (boundary), CC6.7 (transmission — edge TLS is operator-side, webhook HMAC is product), CC6.8 (non-root RO container), CC7.1–7.3 (monitoring/detection/response — rules, canaries, revocation API, runbook), CC7.4/A1.2 (recovery/availability — signed snapshots, standby, active-active, PDB), CC8.1 (audited change ops), C1.1 (confidentiality via minimisation), PI1.x (processing integrity — intent binding, dedupe, atomic commits).

## 6. Findings register

Severity uses CVSS-style qualitative bands against the **documented deployment model** (gateway behind an authenticating edge inside the operator network). None is a remote unauthenticated money-movement path.

| #    | Severity                   | Finding                                                                                                                                                                                                                    | Evidence                                                    | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | **Medium**                 | Gateway listener is plain HTTP **by default**; TLS must terminate at the edge/ingress. Connectors also default `PAYREKHA_URL=http://…`. Bearer tokens and (optionally) hashed beneficiary fields cross this hop.           | `server.ts:5–6,592–633`; `connectors/*.mjs`                 | **Required deployment posture (§7) unchanged:** never expose :8080 outside the trust zone; edge TLS stays the production requirement. **Product option now shipped:** `PAYREKHA_TLS_KEY_FILE`/`PAYREKHA_TLS_CERT_FILE`/`PAYREKHA_TLS_CA_FILE` serve HTTPS on the listener, and `PAYREKHA_TLS_CLIENT_AUTH=required` upgrades it to mTLS — defense-in-depth for networks without a TLS-terminating edge, or where certless lateral movement inside the zone is in scope. mTLS requires probes/scrapes to present client certs. |
| F-02 | ~~Medium~~ **Fixed**       | Connector image installed `kafkajs` with `npm install --no-package-lock … \|\| true` — transitive deps unpinned, and a failed install silently yielded an image that failed at runtime, not build time.                    | `connectors/Dockerfile`, `connectors/package-lock.json`     | **Fixed:** `kafkajs` is now a declared dependency pinned by `connectors/package-lock.json`; the Dockerfile runs `npm ci --omit=dev --ignore-scripts` — the locked transitive tree, no install scripts, and a failed install fails the build.                                                                                                                                                                                                                                                                                 |
| F-03 | Low                        | No attempt-throttling on bearer auth (evaluate/admin). 256-bit tokens make online brute-force infeasible, but repeated-401 alerting is the standard pattern.                                                               | `server.ts:235–246`                                         | Mitigate in SIEM: alert on `payrekha_http_requests_total{status="401"}` bursts. Optional product hardening: per-IP/key failure counters.                                                                                                                                                                                                                                                                                                                                                                                     |
| F-04 | Low                        | Admin plane is a single bearer token (≥16 chars enforced).                                                                                                                                                                 | `config.ts:157`, `server.ts:242–246`                        | BFSI posture: ≥32 chars in a vault, SSO/mTLS proxy in front of admin routes if exposed beyond ops networks, SIEM alert on every `type:"audit"` record. Documented in production checklist.                                                                                                                                                                                                                                                                                                                                   |
| F-05 | ~~Low~~ **Fixed**          | `PAYREKHA_WEBHOOK_URL` was not scheme-validated — `http://` sent HMAC-signed payloads in cleartext.                                                                                                                        | `webhook.ts`, `config.ts:183–184`                           | **Fixed:** non-HTTPS webhook URLs now log a boot warning. HTTPS remains the deployment requirement for regulated environments (warning, not hard error, because internal http endpoints legitimately exist on restricted segments).                                                                                                                                                                                                                                                                                          |
| F-06 | Low                        | `BRIDGE_HOOK_SECRET` optional — an unset secret makes the intent-bridge receiver unauthenticated (it only POSTs to mint, so worst case is noise mints a mint-key still has to sign — bounded by mint ceilings).            | `connectors/webhook.mjs:21,29–33`                           | **Mitigated:** the receiver now logs an unambiguous warning at startup when the secret is unset. Keep bridge + mint endpoints on the same restricted segment in BFSI.                                                                                                                                                                                                                                                                                                                                                        |
| F-07 | Low                        | Demo assets ship static demo keys and the quickstart Envoy sets `failure_mode_allow: true` (payouts proceed uninspected if PayRekha is down).                                                                              | `deploy/docker-compose.yml`, `deploy/quickstart/envoy.yaml` | Documented demo posture; the prod reference config uses `failure_mode_allow: false`. **BFSI:** never promote quickstart configs; run `scripts/verify-deploy.mjs` post-install; the checklist item is explicit.                                                                                                                                                                                                                                                                                                               |
| F-08 | Info→**required for BFSI** | `PAYREKHA_STATE_KEY` is optional. An unsigned snapshot can be crafted to clear HIGH_ALERT / drop canaries by anyone with write access to the state volume (mode still cannot flip — config wins; intents still re-verify). | `snapshot.ts`, `store.ts`                                   | Set `PAYREKHA_STATE_KEY` (≥32 chars) + `PAYREKHA_STATE_KEY_PREVIOUS` for rotation in every BFSI deployment — treat as mandatory.                                                                                                                                                                                                                                                                                                                                                                                             |
| F-09 | Info                       | Shared-state Postgres is a trust anchor: control-row write access can set mode/revocations on all replicas (`applyControl`). Reservations/intents still verify cryptographically, but control state trusts the store.      | `firewall.ts:585–624`, `store-postgres/shared.ts`           | Scope the DB role to the `payrekha_sa_*` tables only; protect connection creds like a signing key; audit `shared-control` actor entries.                                                                                                                                                                                                                                                                                                                                                                                     |
| F-10 | Info                       | Heuristic state (velocity/cooling/fingerprint rings) is per-replica in active-active — budgets multiply by replica count. Intent consumption (the money-critical fact) is atomic in the store.                             | `deploy/envoy/envoy.yaml` comment, ADR 0004                 | Documented Phase-1 limitation; LB affinity by `sourceKeyId` is the mitigation; shared heuristics are a Phase-2 item.                                                                                                                                                                                                                                                                                                                                                                                                         |
| F-11 | Info                       | Snapshot durability window: up to `PAYREKHA_STATE_INTERVAL_MS` (default 5 s) of in-memory bindings can be lost on `kill -9`. Re-evaluation on retry is safe by construction.                                               | `bin.ts:24`, `failure-modes.md`                             | Accept per RPO; Postgres shared-state eliminates it for intent consumption.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F-12 | Info                       | Product is `alpha`; thresholds ship illustrative/untuned.                                                                                                                                                                  | `package.json`, `production-checklist.md`                   | The staged ramp (replay → shadow → advise → enforce per kind) is the designed path — enforce on day one is explicitly contra-indicated by the checklist. GA gates in `docs/ga-criteria.md`.                                                                                                                                                                                                                                                                                                                                  |
| F-13 | Info                       | Admin token length floor (16 hard error) is lower than the checklist recommendation (32).                                                                                                                                  | `config.ts:157–158` vs `production-checklist.md`            | **Mitigated:** boot now warns when the token is <32 chars (hard floor stays 16 so trial installs do not break); demo/CI keys bumped to ≥32. BFSI: use ≥32 regardless — the checklist stands.                                                                                                                                                                                                                                                                                                                                 |
| F-14 | Info                       | `/console` serves a public static shell without CSP headers; all data behind it remains read-role gated.                                                                                                                   | `server.ts:427–430`                                         | Cosmetic; add CSP if the console is enabled on production (`PAYREKHA_CONSOLE=off` is available).                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F-15 | Info                       | Gateway image uses `node:25-slim` (current, not LTS); connectors use `node:22-alpine`.                                                                                                                                     | `deploy/Dockerfile:6`, `connectors/Dockerfile:4`            | Regulated change-control environments may prefer pinning to the active LTS line — a policy choice, not a defect.                                                                                                                                                                                                                                                                                                                                                                                                             |

## 7. Required deployment posture for BFSI

The product's security proofs assume this posture — treat each as a gate, not a recommendation:

1. **TLS terminates at the edge**; port 8080 is reachable only from the payout path and monitoring (NetworkPolicy / security groups — the Helm defaults do this). If the edge does not terminate TLS, serve it on the listener instead: `PAYREKHA_TLS_KEY_FILE` + `PAYREKHA_TLS_CERT_FILE` (+ `PAYREKHA_TLS_CA_FILE` / `PAYREKHA_TLS_CLIENT_AUTH=required` for mTLS).
2. **`PAYREKHA_STATE_KEY` set** (≥32 chars, secret-managed); `PAYREKHA_STATE_KEY_PREVIOUS` during rotations.
3. **Role-scoped API keys**, separate per environment; no roleless keys; `origin` set per key; `keyOrigins` drift detection on.
4. **Issuer keys**: Ed25519 only in production (HMAC issuers are for migration); private keys in KMS/HSM where feasible (`docs/kms.md`); `notAfterMs` set so rotation is exercised, not theoretical.
5. **Admin token ≥32 chars** in the vault; admin routes behind SSO/mTLS where they leave the ops segment; SIEM alert on `type:"audit"` records.
6. **`firewall.maxTimestampSkewMs` set** (e.g. 300 000) and `gateway.trustClientTimestamp` unset/false.
7. **Envoy/proxy `failure_mode_allow: false`** before enforce mode; the decision is deliberate and documented either way.
8. **Every payout route passes the check** — no network path around the filter (this is the boundary the whole model stands on).
9. **Webhook + decision log to your SIEM**; `PAYREKHA_WEBHOOK_URL` is HTTPS; the decision-log volume is persistent, rotated, shipped.
10. **Demo/quickstart configs never reach production** — regenerate all keys via `payrekha init` or your secret pipeline.
11. **Managed mint disabled or ceiling'd in enforce** — externally-signed intents are the strong posture; if mint is used, set `maxAmountPaise`, `mintsPerMinute`, and `modes` caps and keep the `mint` role on its own key.
12. **Postgres (if used)**: dedicated least-privilege role limited to `payrekha_state`/`payrekha_sa_*` tables; TLS to the DB; the connection string never logged (verified in code).

## 8. Pre-production validation plan (test-env → production)

This mirrors the product's designed adoption ramp — each stage is reversible:

| Stage           | Gate                                                                                                                                       | Evidence to file                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| 0. Static       | Review this document + `threat-model.md` + `advisory-mapping.md`; confirm §7 items in the deploy spec                                      | sign-off note                      |
| 1. Install      | `helm lint`/`terraform plan` clean; `scripts/verify-deploy.mjs` all PASS on the test deployment                                            | verify output                      |
| 2. Replay       | `npm run replay` on ≥1 month of production payout export (runs on a laptop, reads a file — cannot touch production)                        | report.html + FP review            |
| 3. Shadow       | ≥2 weeks including a weekend/holiday window; zero unexpected BLOCK-class hits; `payrekha_*` metrics green; decision log flowing to SIEM    | metrics snapshot, SIEM parse proof |
| 4. Drills       | D1 (kill -9 → HIGH_ALERT survives), D3 (second-writer fence), D6 (alert reset audit), plus D8 if active-active                             | drill log per `docs/drills.md`     |
| 5. Advise       | verdicts consumed by payout service as advisory; ops reviews HOLDs                                                                         | review queue records               |
| 6. Enforce      | **per kind, riskiest first** (`modeByKind`), with `failure_mode_allow: false` at the edge and graduation criteria agreed _before_ flipping | config diff + rollback proof       |
| 7. Steady state | monthly D1, quarterly D2/D4; `npm run loadcheck` on prod-class hardware; revoke-drill per issuer key                                       | ops log                            |

## 9. Honest limitations (what an attacker can still do)

Recorded in `docs/threat-model.md` and confirmed in review:

- **The issuer signing key is the crown jewel** — its holder mints valid intents (bounded by velocity/cooling/probes/canaries, and revocable in seconds with `DELETE /v1/issuers/:keyId`, propagation on next commit).
- **The admin token can switch to shadow** — it cannot mint, but it can loosen enforcement; every use is an audit record. Vault it.
- **A path around the filter defeats it** — network policy must make PayRekha the only route to the rails.
- **A compromised shared-state DB** controls control-plane convergence (F-09); intent _validity_ still requires the signing key.
- **PayRekha does not see raw beneficiaries** — it cannot detect "new account number, same fraudster" across re-registration; that detection lives in your KYC/fraud systems (the fraud-feed rule is the bridge).
- It is **not** a WAF, IAM system, EDR, or compliance filing — the exclusions list in `advisory-mapping.md` is the contract.

## 10. Appendix — verify it yourself

```bash
# Build + full test suite (163 tests)
npm ci && npm test

# Zero runtime deps + no network imports in core/rules (CI gate)
npm run check:deps

# Fuzz the parser surface
npm run build && node scripts/fuzz.mjs --n 5000

# Decision log carries only hb1_ refs (empty output = pass)
grep -o '"beneficiaryRef":"[^"]*"' /var/lib/payrekha/decisions.jsonl | grep -v 'hb1_' || echo PASS

# Post-deploy smoke (health, mode, evaluate, canary→HIGH_ALERT→reset)
node scripts/verify-deploy.mjs --url http://localhost:8080 \
  --api-key "$EVAL_KEY" --read-key "$READ_KEY" --admin-key "$ADMIN_KEY" --expect-mode shadow

# Container posture
docker run --rm payrekha:local id -u          # != 0
docker inspect payrekha:local --format '{{.Config.User}}'

# Release provenance (once pulling a published image)
cosign verify ghcr.io/peopleofproduct/payrekha:<tag> \
  --certificate-identity-regexp 'https://github.com/peopleofproduct/payrekha/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

---

_Prepared by internal deep-dive review. Product-side controls are cited to source; operator obligations are named, not claimed. Findings F-01…F-15 should be re-baselined at each release; this document reflects `0.1.0-alpha.2` plus the §6 hardening pass (connector lockfile, gateway TLS/mTLS option, posture warnings)._
