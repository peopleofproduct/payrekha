# Line-by-line review: CERT-In Advisory CIAD-2026-0058 vs PayRekha

_Internal working document — for reference and comparables. Not published advice, not affiliated with or endorsed by CERT-In._

|                      |                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Advisory**         | CIAD-2026-0058 — "Escalation of AI-Driven Attacks on BFSI Entities by Threat Actor CRAFTY FALCON"                    |
| **Issued**           | 04 November 2026 · Severity: **Critical** · Update to CIAD-2026-0046 (09 Oct 2026)                                   |
| **Reviewed against** | PayRekha `0.1.0-alpha.2`, commit `bd4591b`                                                                           |
| **Review date**      | 07 November 2026                                                                                                     |
| **Method**           | Every advisory claim extracted verbatim-ish, then verified against source code and tests — not against README claims |

## Verdict legend

| Verdict          | Meaning                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **COVERED**      | A mechanism exists in code, is exercised by tests or the demo, and does what the advisory asks — at least for the payout surface                                                   |
| **PARTIAL**      | Exists but bounded: defaults to REVIEW rather than BLOCK, is opt-in, depends on deployment/operator wiring, or covers only the money path of a wider directive                     |
| **GAP**          | Within PayRekha's problem space but absent today                                                                                                                                   |
| **OUT OF SCOPE** | Belongs to cloud, endpoint, identity, network or org controls. Checked against `docs/advisory-mapping.md` "What PayRekha does not cover" — anything missing there is flagged in §7 |

> **Reading note on modes.** Verdicts below are what the engine _calculates_. What the payout API _does_ with a verdict depends on `mode`: `shadow` allows everything (logs only), `advise` reports but the caller decides, `enforce` turns REVIEW → HOLD and BLOCK → DECLINE. Several "COVERED" items only bite once a kind is in `advise`/`enforce`. Shadow is the shipped default (`firewall.ts:246`), so treat "coverage" as "coverage once adopted past shadow" throughout.

---

## §1 Overview section

| #   | Advisory claim                                                                                                                                                                                                                                                       | Verdict                     | Evidence & notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | AI-assisted actor "surveys its targets with machine intelligence, operates at machine speed and strikes by invoking the victim's own payment and disbursement APIs"                                                                                                  | **COVERED (design centre)** | The whole product is built on this premise: the payout caller is assumed compromised, so authority to move money requires a signed _intent_ from a separate system of record (`packages/core/src/intent.ts`, `registry.ts`). Machine speed is met in-process: measured p99 ~19 µs eval; per-key/merchant/global velocity budgets catch bursts even when every call is individually well-formed (`behaviour.ts` `velocity.outflow`).                                                             |
| O2  | "Entities… re-targeted after incomplete remediation"; attacks "timed to coincide with holidays, weekends and other low-monitoring windows"                                                                                                                           | **COVERED**                 | Two dedicated mechanisms: (a) `HIGH_ALERT` — never auto-expires, survives restarts and snapshots, only clears with an admin-token reset + mandatory reason, every attempt audited (`firewall.ts:482-500`, restore `636-649`; test `core.test.ts:228`). (b) IST `Calendar` — holidays, weekends and low-coverage hours flip the state to `HOLIDAY`, halving velocity and cooling thresholds by default (`calendar.ts`, `DEFAULT_MULTIPLIERS` `firewall.ts:80-84`; test `rules.test.ts:158-164`). |
| O3  | Named tooling — "ARTEX" LLM family, "PentAGI" multi-agent pentest, "Cairn" search engine, "CyberStrikeAI" — executes attack chains autonomously, mutates payloads; infra rotates IPs in hours-to-days; fingerprints/detection rules shared via restricted advisories | **PARTIAL**                 | Two of three implications are covered by construction: payload mutation is irrelevant (the intent check is invariant — a mutated request still needs a matching signed intent), and IP rotation is irrelevant (no source-IP trust anywhere in the model). Detecting the _tools themselves_ (downloads, LLM traffic, script bursts) is out of scope — see RA20/RA21/RA25. Restricted-advisory IoCs are not consumed — **already declared** in advisory-mapping.md.                               |

---

## §2 Description — the nine attack patterns

### D1 — Cloud management services abused for command execution and file drops (SSM, Lambda), blended into legitimate channels

**Verdict: OUT OF SCOPE.** Initial access / lateral movement layer. PayRekha sees only the payout call at the end of the chain — which is the point: however the attacker got in, they still cannot mint an intent. Countermeasures are cloud controls (RA3–RA5). Not yet listed in advisory-mapping.md exclusions → §7.

### D2 — Internet-exposed non-production environments (UAT/staging/testing) as entry, then movement to production via shared credentials, tokens or network paths

**Verdict: PARTIAL → COVERED at the money path.** `origin.nonprod` BLOCKs any payout under a non-prod key or a non-prod-routed call (`environment.ts:19-38`). Critically, `origin` is **asserted by the gateway, never taken from the request body**: on `/v1/evaluate` it comes from the API key's configured `origin` (`server.ts:222`, test `gateway.test.ts:113`); on ext_authz from the Envoy listener config or an Envoy-set header (`server.ts:408-409`).
**Dependency:** the "shared credentials" leg of the advisory's wording matters — `origin` pins _the key_ to an environment. If one key is used in both UAT and prod, PayRekha cannot tell the call's true network origin; the defence reduces to the intent binding (still BLOCK without intent) and behaviour rules. Deployment rule: separate keys per environment — this is what `PAYREKHA_API_KEYS`' `id:origin:token` format enforces (`config.ts:45-62`).
Isolation itself is the operator's job — already declared in advisory-mapping.md.

### D3 — Codebases reverse-engineered; unauthorized API calls from altered/repackaged application packages, defeating "only our app calls this API" assumptions

**Verdict: COVERED.** This is the core thesis: server-side validation does not trust _who_ is calling. A repackaged app still needs a signed intent for a kind+amount+beneficiary the system of record authorised. Additional signal: `client.unattested` (REVIEW) for kinds in `requireAttestation` — note `clientAttested` is a _declared boolean_ asserted by the payout API after its own attestation check, not verified by PayRekha (honestly documented in `threat-model.md:31`). Demo: the canary-beneficiary step models a payout originating from a repackaged APK (`demo.mjs:74`).

### D4 — IP allow-listing bypassed via whitelisted third-party fetcher IP pools (content-acceleration, app-store review fetchers)

**Verdict: COVERED.** There is no IP-based trust anywhere in the request path — no IP fields exist in `PayoutRequest` or `DecisionRecord` (verified: `types.ts:74-110`, `log.ts:8-34`). A call relayed through a whitelisted fetcher pool is evaluated exactly like any other: key + origin + intent + behaviour. This directly implements RA13's "identity-based controls" for the payout surface.

### D5 — Micro-value test transactions (₹1) to validate fund flows before large transfers

**Verdict: COVERED.** `probe.micro-then-large` (`behaviour.ts:21-48`): remembers the last micro payout per beneficiary (≤ ₹10 default), fires when a "large" (≥ ₹10,000 or ≥ 100× the micro, defaults) lands within 24 h. Defaults to REVIEW → HOLD in enforce — matching the advisory's own "hold or review" language (RA16); upgrades to BLOCK in HIGH_ALERT. The lender-specific false positive is handled: a micro authorised by a `VERIFICATION` intent marks the beneficiary verified _for that subject_, so legitimate penny-drop → disbursal flows pass while a probe for a different subject still fires (`behaviour.ts:33-37`, `firewall.ts:369-384`; tests `rules.test.ts:104-143`; docs `penny-drop.md`).

### D6 — Merchant settlement APIs of payment aggregators exploited/abused

**Verdict: COVERED.** Three layers: `settlement.over-captured` BLOCK — settlement may not exceed the reconciled net carried as the intent's `maxAmountPaise` (`settlement.ts:8-21`); `settlement.account-changed` REVIEW → HOLD for 24 h after a settlement-account change — the maker-checker "second look" (`settlement.ts:29-52`, fed by `MerchantLedger` + explicit `noteMerchantAccountChange`); plus abuse-blast-radius controls: per-merchant velocity budget, and `merchantIds` key scoping so a stolen key can only settle for its own merchants (`server.ts:222-226`, `config.ts:25`, tests `rules.test.ts:212-237`, `gateway.test.ts:180`).

### D7 — Newly published vulnerabilities exploited within hours of disclosure (file-upload, deserialization → web shells in PHP and Node.js)

**Verdict: OUT OF SCOPE.** Patching/WAF/virtual patching — already declared in advisory-mapping.md. PayRekha's answer is consequence-limiting: a web shell inside the payout host still cannot mint an intent (the signing key lives elsewhere), and `origin.nonprod`/behaviour rules bound what a planted shell can do to money.

### D8 — Crypto exchanges / VDA service providers targeted; wallet keys stolen; funds siphoned from wallets

**Verdict: PARTIAL → COVERED at the withdrawal-decision layer.** First-class support: `VDA_WITHDRAWAL` kind + `CRYPTO` channel + `{address, network}` beneficiary identifier (`types.ts:24-43`, `hash.ts:11,40`); intents bind withdrawal → address + ceiling + window + use-count; all behaviour rules apply; `feed.reputation` can flag risky _mobiles_. Ext_authz test proves crypto beneficiary hashing + intent binding (`gateway.test.ts:137`). Wallet-key custody (HSM/cold storage) and on-chain controls are out of scope; multi-signature caveat under RA19.

### D9 — Large numbers of tailored scripts, functionally identical variants refined in rapid succession — AI-generated attack tooling

**Verdict: PARTIAL → COVERED at the rail.** Payload mutation does not help: the intent binding is invariant across variants (kind/ceiling/beneficiary/window/uses must all match a _registered_ signed intent). Machine-speed parallel attempts are bounded by `velocity.outflow` per key/merchant/global, and a burst of BLOCKs itself escalates to HIGH_ALERT (`highAlertOnBlocks`, default 5 blocks/10 min, `firewall.ts:395-403`, persisted across restarts `firewall.ts:647`). Detecting the tooling is out of scope (RA20/RA25).

---

## §3 Recommended Actions — all 27, one by one

### RA1 — Treat as active and escalating: heightened 24×7 monitoring, increased staffing, **lowered alert thresholds during holidays, weekends and low-coverage windows**

**Verdict: PARTIAL.** The _lowered-thresholds_ clause is implemented verbatim and automatically: `HOLIDAY` state multipliers (velocity ×0.5, cooling-amount ×0.5 — configurable, `firewall.ts:80-84`), evidence-tagged by `calendar.window`; `HIGH_ALERT` tightens to ×0.25. Weekends and 23:00–06:00 IST are detected automatically; holidays come from an operator calendar file (quickstart ships the Diwali-2026 window, `deploy/quickstart/calendar.json`). The _24×7 monitoring + staffing_ clause is the SOC's job — PayRekha feeds it: JSONL/CEF decision log, Prometheus metrics + shipped alerts (`deploy/prometheus/alerts.yml`: `PayrekhaHighAlert`, `PayrekhaBlocks`, …), HMAC-signed SOAR webhooks.

### RA2 — After any incident, assume persistence: full eradication + forensic verification + periodic threat hunting; entities re-attacked after incomplete remediation

**Verdict: PARTIAL → COVERED for the "assume persistence" posture.** `HIGH_ALERT` is the architectural embodiment: entered via canary trip, block-burst, or manual raise; **never auto-expires**; survives snapshot restore (even revocations and the in-window block counter are restored — `firewall.ts:636-649`); clearing needs the admin token + a recorded reason, audited (`firewall.ts:493-500`). Under HIGH_ALERT _every_ payout kind requires an intent and behavioural thresholds are 4× tighter. Eradication/forensics/threat-hunting are IR functions — out of scope, implicitly covered by declared exclusions.

### RA3 — Centralized real-time monitoring of cloud audit logs; alert on remote command execution, function code updates, role/user/key creation

**Verdict: OUT OF SCOPE.** Cloud control-plane monitoring. Declared ("Cloud audit logging") in advisory-mapping.md.

### RA4 — Restrict cloud management and serverless execution to approved principals; alert on interactive remote-management or function code change in production

**Verdict: OUT OF SCOPE.** IAM/cloud hardening → §7 (not yet explicitly listed in exclusions).

### RA5 — IMDS protections, least-privilege instance/function roles, deny wildcard egress, no Internet egress for serverless by default

**Verdict: OUT OF SCOPE.** Cloud/network hardening. Egress control is already declared; IMDS → §7.

### RA6 — Isolate UAT/staging/testing from production — no shared credentials, tokens, keys, databases or direct network paths; production-grade hardening for internet-facing non-prod

**Verdict: PARTIAL.** The isolation itself is the operator's job — already declared ("Removing or isolating exposed UAT/staging… PayRekha only refuses to let them move money"). The _money-path backstop_ when isolation fails is covered: `origin.nonprod` BLOCK + role-scoped keys (a nonprod-origin key can be denied `evaluate` entirely). See D2 caveat on shared keys.

### RA7 — Alert on and investigate any access from non-production systems to production systems, credentials or data

**Verdict: PARTIAL.** For the payout surface: covered — a nonprod-origin payout is BLOCKed _and_ emitted to the decision log/SIEM/webhook as high-value evidence. For the general case (any access, credentials, data): SIEM/EDR/cloud alerting — out of scope.

### RA8 — Read-only deployment directories for the runtime user; file-integrity monitoring for web-shell detection

**Verdict: OUT OF SCOPE.** Host hardening/FIM. Note PayRekha hardens _itself_ this way (non-root, read-only root FS, `cap_drop: ALL` — `deploy/Dockerfile`, `threat-model.md:35`) but cannot protect the operator's app hosts → §7.

### RA9 — Treat client apps/packages as untrusted: server-side validation of every transaction and business rule; **API request signing with nonce and timestamp**; app attestation + certificate pinning

**Verdict: COVERED (in substance).** Server-side validation of every transaction: yes — shape check + intent binding + rules on every call; malformed input is a degraded REVIEW, never a silent ALLOW (`engine.ts:77-110`). Request-signing-with-nonce-and-timestamp: PayRekha goes further — the _intent_ is a business-level signature bound to kind/ceiling/beneficiary/window/uses; replay is structurally dead (`intent.reused`, payoutId↔intent lifetime binding, per-caller dedupe — `registry.ts:179-195`, tests `core.test.ts:343`, `rules.test.ts:77-101`). Caller timestamps are never trusted for decisions (gateway stamps server time, keeps caller value as `clientTimestampMs` evidence, `server.ts:227-232`; `maxTimestampSkewMs` → `time.skew` degraded REVIEW). App attestation: `client.unattested` REVIEW for configured kinds — **opt-in** and depends on the payout API asserting the result (declared in threat-model). Certificate pinning: client-side, out of scope.

### RA10 — Rapid patching SLA for internet-facing apps (file-upload, deserialization in PHP/Node); WAF virtual patching as interim

**Verdict: OUT OF SCOPE.** Declared ("Patching and vulnerability management").

### RA11 — No hardcoded tokens/credentials in source or build; automated secret scanning across repos and CI/CD; short-lived fine-grained least-privileged tokens; rotate build/deploy tokens

**Verdict: OUT OF SCOPE.** Declared ("Secret scanning of your own code… PayRekha's CI scans only PayRekha"). Worth noting: PayRekha's _own_ access model follows the directive — gateway API keys are bearer tokens stored only as SHA-256 hashes, role-scoped (`evaluate`/`intents`/`outcomes`/`read`/`mint`), optionally merchant-scoped; the admin token is separate, and every admin action demands a reason that lands in the audit trail (`server.ts:13-37`, `firewall.ts:543-554`).

### RA12 — **Alert on token usage from unusual source IPs, user agents or geographies**; branch protection, commit signing, mandatory code review on production deployment branches

**Verdict: PARTIAL — contains a real gap.** The second half (branch hygiene) is out of scope for the product (PayRekha's _own_ repo does signed commits/protected branches — `repository-settings.md`). The first half is the closest thing to a miss: **PayRekha captures no source-network attributes** — no IP, user-agent or geography exists in `PayoutRequest` or `DecisionRecord`. Adjacent coverage: per-`sourceKeyId` velocity, `origin` assertions, and the decision log do give the SIEM _something_ to correlate (and an unusual-IP alert would live in the WAF/API-gateway layer anyway). But an operator reading RA12 cannot point to a PayRekha field that feeds it. → **Gap G2** (§6): either document explicitly as SIEM-side, or carry an optional asserted-source hint (e.g. Envoy-set `x-forwarded-for`/UA) into the decision record as untrusted evidence.

### RA13 — Replace IP allow-listing of shared third-party fetcher pools with identity-based controls (mTLS, signed requests, scoped API keys on dedicated vendor endpoints)

**Verdict: COVERED — this is the product's model.** Identity, not network: role-scoped hashed API keys + Ed25519-signed intents + gateway-asserted origin. PayRekha does not itself implement mTLS to vendor endpoints (that's the API gateway/Envoy layer), but it removes the failure mode the advisory describes from the money path entirely (see D4).

### RA14 — Default-deny egress from server segments via allow-listed proxies (unrestricted HTTPS egress was used for C2 and exfiltration)

**Verdict: OUT OF SCOPE.** Declared ("network egress control"). PayRekha's own posture aligns: core and rules make zero network calls (`check:deps` enforced in CI); the gateway's only outbound call is the operator-configured webhook.

### RA15 — TLS inspection with alerting on self-signed certs over non-standard ports

**Verdict: OUT OF SCOPE.** Declared ("TLS inspection").

### RA16 — Flag micro-value test transactions to new beneficiaries followed by high-value transactions; **hold or review such flows** — strong precursor of unauthorized transfer

**Verdict: COVERED — verbatim.** `probe.micro-then-large` (D5) does exactly this pattern (micro → large, same beneficiary, 24 h window) and returns REVIEW → **HOLD** in enforce — the advisory's own words. New-beneficiary aspect reinforced by `beneficiary.cooling`. Penny-drop exemption keeps it usable at real lenders.

### RA17 — Transaction velocity rules, new-beneficiary cooling periods and amount-band anomaly detection **across all payment and disbursement paths**

**Verdict: COVERED — the three named controls exist 1:1.** `velocity.outflow` (per source key / merchant / global, 10-min window, REVIEW over budget, BLOCK over 2×; alert-state-scaled; churn-safe separate maps — `behaviour.ts:111-188`, tests `rules.test.ts:167-199`); `beneficiary.cooling` (first-seen < 30 min and amount > ₹50k → REVIEW; scales in HOLIDAY/HIGH_ALERT — `behaviour.ts:64-87`); `amount.band-anomaly` (median/MAD robust-z over rolling 256-sample per kind+channel — `behaviour.ts:207-250`). "Across all paths" is a deployment property — PayRekha must sit on every rail (bypass is declared out of scope: network policy).

### RA18 — Server-side validation, **maker-checker approval** and reconciliation for all merchant settlement instructions through PA APIs

**Verdict: COVERED.** Server-side validation: `PA_SETTLEMENT` intents verified against issuer key, kind, ceiling, beneficiary, window. Reconciliation enforced cryptographically: `settlement.over-captured` BLOCKs any settlement above the reconciled net the _settlement engine_ signed into the intent. Maker-checker: `settlement.account-changed` holds (REVIEW→HOLD) changed-account settlements for human sign-off; the human checker remains the operator. Bonus: merchant-scoped API keys limit a stolen key to its own merchants.

### RA19 — Crypto wallet keys in HSM/cold custody; **multi-signature approvals for withdrawals**; monitor withdrawal patterns; rotate keys on suspected compromise

**Verdict: PARTIAL.** Covered at the decision layer: `VDA_WITHDRAWAL` + `CRYPTO` supported end-to-end (D8); intents bound to wallet address + network + ceiling; anomaly monitoring via velocity/band/cooling/probe rules; **key rotation on compromise**: runtime `revokeIssuerKey` — admin-gated, audited, tombstoned in the snapshot so a restart cannot un-revoke (`firewall.ts:526-531`, `server.ts:368-382`, test `core.test.ts:415`). Not covered: (a) literal m-of-n _multi-signature_ approval — a payout binds **one** intent from **one** issuer; the model is "two keys" (payout credential + intent signer), not n-of-m approvers → **Gap G3** (§6); (b) HSM custody of the exchange's wallet keys themselves — infra scope (though issuer signing keys are HSM/KMS-recommended, `intent.ts:42`).

### RA20 — Prohibit/monitor unauthorized security and attack tools incl. public AI-driven offensive frameworks; watch for AI coding-agent processes with permission checks disabled

**Verdict: OUT OF SCOPE.** Endpoint/app-allowlisting + EDR → §7.

### RA21 — Monitor and govern LLM API usage/keys; LLM API traffic from servers or non-dev hosts may indicate an attack rig

**Verdict: OUT OF SCOPE.** Egress/proxy monitoring → §7 (adjacent to RA14 but should be named explicitly).

### RA22 — Written approval, defined scope and time window for all penetration testing; "the tools themselves do not validate authorization"

**Verdict: OUT OF SCOPE** — with a design echo worth noting: a PayRekha _intent_ is precisely "written approval, defined scope and a time window" for money — signed, kind-scoped, amount-capped, beneficiary-bound, time-boxed (`notBeforeMs`/`expiresAtMs`), counted (`maxUses`). For the payout surface, authorization _is_ validated by the tool. The pentest-governance policy itself is org process.

### RA23 — Tune SIEM for machine-speed multi-technique patterns (parallel threads, payload mutation, non-business-hours ops vs a single target); adopt automated SOAR-based containment

**Verdict: PARTIAL.** PayRekha supplies the inputs and the containment hook, not the SIEM content: every decision line carries rules/alertState/origin/sourceKeyId/degraded fields the SOC can correlate (`log.ts`); CEF output maps BLOCK→sev 9 (`log.ts:82-112`); `payout.blocked` + `alert.entered`/`alert.cleared` webhooks are HMAC-signed, retried, non-blocking (`webhook.ts`); shipped Vector config forwards to Splunk/Sentinel/Elastic (`deploy/siem/vector.toml`, `docs/integrations/siem.md`). **Automated containment exists**: Envoy ext_authz returns 403 on HOLD/DECLINE; HIGH_ALERT can be raised via `PUT /v1/state` (admin-gated at HTTP; in-process `raiseHighAlert` needs no credential — "anyone may pull the alarm", `firewall.ts:478-480`); the block-burst escalator is itself automated containment. Non-business-hours operation is captured by `calendar.window` evidence. Missing piece worth flagging: no shipped _correlation queries_ for the multi-technique pattern the advisory describes — candidate docs deliverable, not code (§6, D-3).

### RA24 — Deception: honeypots, decoy admin panels, canary credentials — autonomous agents enumerate exhaustively and touch decoys → high-confidence early alerts

**Verdict: COVERED (payout-surface deception).** `canary.tripped`: three canary classes — beneficiary refs (e.g. planted in an APK), source key ids (canary credentials — the advisory's exact words), intent ids — touched ⇒ BLOCK + automatic `HIGH_ALERT` (`environment.ts:41-57`, `ledger.ts:93-119`). Admin-managed via `POST /v1/canaries` (raw identifiers accepted and hashed at entry, `server.ts:383-397`); persists across restarts; demo shows the full trip→HIGH_ALERT→instant-block sequence (`demo.mjs:74-75`, test `rules.test.ts:253-269`). Broader honeypots/decoy consoles are infra scope.

### RA25 — Monitor web roots/temp dirs/staging paths for bursts of commented scripts and functionally-identical variants — indicator of AI-generated tooling

**Verdict: OUT OF SCOPE.** Host/FIM content monitoring → §7.

### RA26 — Zero-trust, micro-segmentation, identity-based access per user/service, east-west traffic inspection — assume the actor is already inside

**Verdict: PARTIAL → COVERED at the money path.** PayRekha _is_ the zero-trust instantiation for payouts: `threat-model.md:5` assumes the attacker is inside with valid credentials; every payout is re-authenticated against a signed business intent; nothing is trusted by network position (D4). Micro-segmentation and east-west inspection are network architecture — out of scope, implicitly covered by network exclusions → could be named in §7.

### RA27 — On detection: isolate hosts, preserve forensic evidence and logs, rotate all credentials, report to CERT-In/CSIRT-Fin

**Verdict: PARTIAL.** PayRekha supplies the payout-plane pieces: an append-only JSONL/CEF **forensic trail** (every decision with rule ids, ₹-denominated reasons, structured evidence; audit lines for every admin action; file written `0600` — `log.ts`); **credential rotation** for its own layer — runtime issuer-key revocation (survives restarts) + bearer-token replacement is config-only. Host isolation, forensic imaging and the CERT-In/I4C report remain the entity's IR obligation — declared in advisory-mapping.md ("Incident reporting to CERT-In"). → Recommend naming **I4C / CFCFRMS** alongside CERT-In in docs (§7) since the advisory's conclusion requires bulk-fraud reporting there.

---

## §4 Conclusion section

| #   | Advisory claim                                                                                                                                                                   | Verdict                | Notes                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Report suspicious activity to CERT-In/CSIRT-Fin (`incident@cert-in.org.in`) with logs; report bulk fraudulent transactions to I4C Cyber Fraud Mitigation Centre (CFCFRMS portal) | **OUT OF SCOPE**       | Process obligation — declared. PayRekha's decision log is the natural evidence bundle for the payout surface (hash-only refs keep it shareable). Recommend adding the I4C/CFCFRMS pointer to `docs/operations.md`/runbook (§6 D-4). |
| C2  | "Indicators may change while adversary techniques often remain consistent; entities should therefore not limit their response to blocking indicators"                            | **ALIGNED (strength)** | PayRekha is deliberately _behaviour- and authorization-based_, not IoC-based — it does not consume the advisory's restricted indicators at all (declared). This is the posture the advisory itself prescribes.                      |

---

## §5 Scorecard

### Recommended Actions (27)

| Verdict               | Count      | Items                                                              |
| --------------------- | ---------- | ------------------------------------------------------------------ |
| COVERED               | 7          | RA9, RA13, RA16, RA17, RA18, RA24 + (RA22's design parallel aside) |
| PARTIAL               | 9          | RA1, RA2, RA6, RA7, RA12*, RA19, RA23, RA26, RA27                  |
| GAP (in-scope misses) | 1 embedded | RA12's token-usage IP/UA/geo signal → G2                           |
| OUT OF SCOPE          | 11         | RA3, RA4, RA5, RA8, RA10, RA11, RA14, RA15, RA20, RA21, RA25       |

### Attack patterns (9)

| Verdict      | Count | Items          |
| ------------ | ----- | -------------- |
| COVERED      | 4     | D3, D4, D5, D6 |
| PARTIAL      | 3     | D2, D8, D9     |
| OUT OF SCOPE | 2     | D1, D7         |

### Honest bottom line

- **Every payout-surface directive is covered**: intent binding (stolen credentials, replayed/tampered transactions), ₹1-then-large probes, velocity/cooling/band, settlement abuse, UAT-origin keys, holiday tightening, canary deception, persistent HIGH_ALERT, SIEM/SOAR telemetry. Nothing in the advisory's _payout_ column is unaddressed.
- **All misses are one of three shapes**: (a) genuinely outside a payout firewall (cloud, endpoint, patching, identity, org process) — most already declared; (b) REVIEW-by-default or opt-in mechanisms needing operator config to bite; (c) three real gaps worth tracking → §6.
- The advisory's own closing guidance — _techniques over indicators_ — is the exact posture PayRekha implements.

---

## §6 Gaps and recommended follow-ups

_Status after Wave 0 + A1 of `production-readiness-plan.md` (07 Nov 2026): G1, G4, G6 and §7 are closed; G2, G3, G5 (code guardrails) remain open, scheduled in Waves 1–2._

| #      | Gap                                                                                                                                                                                                                         | Advisory anchor                        | Class                              | Status                                                                                                                                                                                                                                              | Suggested follow-up                                                                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1** | `feed.reputation` only keys on `beneficiaryMobileRef` — operator mule/suspect lists are mostly **account+IFSC, VPA, or wallet address**                                                                                     | D8, RA17–RA19 (mule/monitoring intent) | Code gap (small)                   | **Closed — Wave 1 (A1)**: `FraudFeed` accepts `ref` (any `hb1_` type), raw `beneficiary` (account+IFSC/VPA/mobile/VDA address, hashed on load), plus legacy `mobile`/`mobileRef`; rule checks `beneficiaryRef` + `beneficiaryMobileRef`, worse band wins; `scripts/csv-to-feed-snapshot.mjs` converts operator CSVs; tests + `docs/rules/feed.reputation.md` updated | —                                                           |
| **G2** | No source-network attributes (IP / user-agent / geography) captured anywhere → RA12's "alert on token usage from unusual source IPs, user agents or geographies" has no PayRekha-side field                                 | RA12 (first clause), D2                | Code gap (small-medium) or doc fix | **Partially mitigated — declared SIEM-side in advisory-mapping.md exclusions; code fix open (plan A2, Wave 1)**                                                                                                                                     | Cheapest honest fix: an optional `sourceHint` evidence field populated from an Envoy-asserted header (untrusted evidence, like `clientTimestampMs`), plus an `identity.fingerprint` rule                         |
| **G3** | No m-of-n multi-approval — a payout binds exactly one intent from one issuer; advisory asks for multi-signature approvals on crypto withdrawals                                                                             | RA19                                   | Code gap (medium)                  | **Open — Wave 2 (plan A3); declared roadmap in advisory-mapping.md**                                                                                                                                                                                | Design candidate: optional `minApprovals`/co-signer intents per kind (N registered intents required to satisfy binding); also relevant to maker-checker for very large fiat payouts. Roadmap item, not quick fix |
| **G4** | `origin.nonprod` cannot see a **prod key used from non-prod infrastructure** when keys are shared across environments                                                                                                       | D2, RA6–RA7                            | Deployment dependency              | **Closed (docs) — Wave 0**: per-env key separation required in `production-checklist.md`, scope note in `docs/rules/origin.nonprod.md`, threat-model row added. Optional key-vs-route origin mismatch evidence remains a possible small enhancement | —                                                                                                                                                                                                                |
| **G5** | `mintIntent` tier colocates the signing key on the gateway — weakens "two keys" storey to "one host" if the payout caller can also reach mint                                                                               | RA9, threat-model premise              | Documented trade-off               | **Doc part closed — Wave 0**: "When the mint tier is acceptable" in `docs/adoption.md`. Code guardrails (separate listener, per-kind mint caps) remain open (plan A5)                                                                               | —                                                                                                                                                                                                                |
| **G6** | No shipped SIEM correlation content for the advisory's machine-speed multi-technique pattern                                                                                                                                | RA23                                   | Docs gap                           | **Closed — Wave 0**: `deploy/siem/queries/{splunk.spl,sentinel.kql,elastic.esql}` + pattern→query table in `docs/integrations/siem.md`                                                                                                              | —                                                                                                                                                                                                                |
| **G7** | REVIEW-default rules (`probe`, `cooling`, `account-changed`, `band-anomaly`, `client.unattested`, `feed` <VERY_HIGH) are advisory-aligned ("hold or review") but only bite in `advise`/`enforce` — shadow allows everything | RA16–RA18                              | By design / docs emphasis          | Standing guidance — graduation path documented in adoption/checklist                                                                                                                                                                                | No code change                                                                                                                                                                                                   |

## §7 Exclusions to add to `docs/advisory-mapping.md` "What PayRekha does not cover"

**Done (Wave 0)** — all items below were added to the exclusion list, plus new mapping rows for untrusted clients/request signing, token-usage anomaly, and multi-signature approvals.

Original list already covered: cloud audit logs, patching, operator secret scanning, TLS inspection, EDR, identity/MFA, UAT isolation, restricted IoCs, CERT-In reporting, network-path bypass. Added for CIAD-2026-0058's wording:

- Cloud control-plane hardening: IMDS protections, least-privilege instance/function roles, security-group egress (RA4–RA5)
- File-integrity monitoring / web-shell detection on application hosts (RA8, RA25)
- Detection of AI offensive tooling and governance of LLM API usage/keys (RA20–RA21)
- Branch protection, commit signing and code review on the _operator's_ production deployment branches (RA12)
- Penetration-test authorization policy (RA22)
- Org-wide zero-trust / micro-segmentation / east-west inspection (RA26)
- mTLS / signed-request replacement for shared fetcher-pool allow-listing at vendor endpoints — PayRekha removes IP trust from the payout path but does not itself implement vendor-endpoint mTLS (RA13 nuance)
- Reporting to I4C / CFCFRMS for bulk fraudulent transactions (name alongside CERT-In reporting)

## §8 Operator configuration checklist — what "covered" actually requires

| Directive                           | Required config/wiring                                                                                     | Where                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Intent required on a kind           | Default is required for **all** kinds; `requireIntent: {KIND: false}` opts out — audit your file           | `firewall.requireIntent`                |
| Money actually held                 | `mode: advise` or `enforce` (per kind or global); shadow only logs                                         | `firewall.mode`                         |
| UAT keys blocked                    | Every API key carries `origin: prod                                                                        | nonprod`; separate keys per environment | `PAYREKHA_API_KEYS` format |
| Nonprod network detection via Envoy | Route-level `origin` or `originHeader` asserted by Envoy, not the client                                   | `extAuthz.origin`, `originHeader`       |
| Holiday tightening                  | Holiday calendar file loaded (`calendarFile`); weekends/nights automatic; multipliers configurable         | `deploy/quickstart/calendar.json`       |
| Canaries planted                    | `POST /v1/canaries` (admin) — beneficiary/sourceKey/intent                                                 | gateway                                 |
| Fraud feed live                     | `feedSnapshot` path in `payrekha.json` + raw-mobile hashing key                                            | `config.ts:126`                         |
| Attestation enforced                | `requireAttestation: [kinds]` + payout API asserting real attestation                                      | `rules.requireAttestation`              |
| Two-keys storey preserved           | External signing for enforce; `mint` only as adoption ramp; mint key ed25519 only                          | `PAYREKHA_MINT_*`                       |
| Forensic trail on                   | `PAYREKHA_DECISION_LOG` (+ `cef` optional); webhook for SOAR                                               | env                                     |
| HIGH_ALERT reachable by SOC         | admin token held by SOC; `PUT /v1/state {highAlert:'raise'}` audited; Prometheus `PayrekhaHighAlert` wired | env + alerts.yml                        |
| State survives restarts             | `PAYREKHA_STATE_FILE` or `_PG_URL` + `PAYREKHA_STATE_KEY` (signed snapshots)                               | env                                     |

## §9 Evidence index (code ⇄ claims)

| Mechanism                                                                                     | Source                                                         | Tests/demo                                     |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| Intent sign/verify (Ed25519, HMAC; key scope, rotation, revocation)                           | `packages/core/src/intent.ts`                                  | `core.test.ts:73-115`, `rules.test.ts:11-102`  |
| Intent registry: register/check/reserve/release/settle, payoutId lifetime binding, tombstones | `packages/core/src/registry.ts`                                | `core.test.ts:293-446`, `rules.test.ts:77-101` |
| intent.* rules (7, all BLOCK)                                                                 | `packages/rules/src/intent.ts`                                 | `rules.test.ts:11-102`                         |
| probe.micro-then-large + penny-drop exemption                                                 | `packages/rules/src/behaviour.ts:21-48`, `firewall.ts:367-393` | `rules.test.ts:104-143`, `docs/penny-drop.md`  |
| beneficiary.cooling                                                                           | `behaviour.ts:64-87`                                           | `rules.test.ts:145-165`                        |
| velocity.outflow (key/merchant/global, churn-safe, state-persistent)                          | `behaviour.ts:111-188`                                         | `rules.test.ts:167-199`                        |
| amount.band-anomaly                                                                           | `behaviour.ts:207-250`                                         | `rules.test.ts:201-210`                        |
| settlement.over-captured / account-changed                                                    | `settlement.ts`                                                | `rules.test.ts:212-237`                        |
| origin.nonprod                                                                                | `environment.ts:19-38`                                         | `rules.test.ts:239-251`, `gateway.test.ts:113` |
| canary.tripped + CanaryRegistry                                                               | `environment.ts:41-57`, `ledger.ts:93-119`                     | `rules.test.ts:253-269`, `gateway.test.ts:162` |
| client.unattested                                                                             | `environment.ts:60-72`                                         | `rules.test.ts:301-307`                        |
| calendar.window + HOLIDAY multipliers                                                         | `environment.ts:78-93`, `calendar.ts`, `firewall.ts:80-84`     | `rules.test.ts:271-281`, `:158-164`            |
| feed.reputation + FraudFeed                                                                   | `feed.ts`                                                      | `rules.test.ts:283-299`                        |
| external.* (advisory-only upstream signals)                                                   | `external.ts`                                                  | `rules.test.ts:309-328`                        |
| Engine semantics (malformed→degraded REVIEW, rule-error isolation, worst-verdict fold)        | `engine.ts`                                                    | `core.test.ts:117-160`                         |
| Modes / alert states / HIGH_ALERT persistence / admin auth / audit                            | `firewall.ts`                                                  | `core.test.ts:203-446`                         |
| Timestamp trust boundary (`time.skew`)                                                        | `firewall.ts:279-324`                                          | `core.test.ts:447-481`                         |
| Gateway: roles, merchant scope, origin assertion, mint, budgets, analyst API                  | `gateway/src/server.ts`, `config.ts`                           | `gateway.test.ts`                              |
| Decision log JSONL/CEF, audit records, signed webhooks, metrics                               | `gateway/src/log.ts`, `webhook.ts`, `metrics.ts`               | `gateway.test.ts:355-385`                      |
| Attack-chain replay                                                                           | `examples/demo.mjs`                                            | `npm run demo` (8 steps, ₹0 out)               |
| Deploy hardening (non-root, read-only, healthcheck, Prometheus alerts, Vector→SIEM)           | `deploy/`                                                      | —                                              |
