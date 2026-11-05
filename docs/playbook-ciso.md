# Payrekha for CISOs — the security playbook

*From advisory to deployed control: what Payrekha covers, what it doesn't,
and exactly how it slots into your stack and your compliance story.*

---

## 1. The situation you're in this week

CERT-In Advisory **CIAD-2026-0058** (and its CRAFTY FALCON campaign
attribution) describes attackers who **operate inside with valid
credentials** — not exploiting the perimeter, but using your payout APIs
correctly, from the inside. Their signature:

- ₹1-probe transactions before large-value movement
- holiday/weekend/night execution when SOC staffing is thin
- beneficiary and settlement-account changes before draining
- UAT/test credentials used in production contexts
- insider-held or stolen service credentials — calls your API gateway
  correctly authenticates

Every control you have today — WAF, API gateway authn, IAM, perimeter —
authenticates the **caller**. None of them asks whether the **payout was
decided by a legitimate system of record**. That gap is the attack surface,
and it's exactly what this product closes.

## 2. What Payrekha is in your control stack

A **compensating control at the payout layer** — in-process, in your
network, fail-open by design. It adds a second authorization factor *the
attacker can't steal with a service credential*: a signed business intent
from your system of record.

```
attacker with stolen prod key → calls payout API ✔ authn passes
                              → shows no matching intent ✘ Payrekha holds
```

Because it runs in shadow by default, deploying it **cannot make things
worse**: observe-only, `failure_mode_allow` on Envoy, and a degrade-to-REVIEW
posture rather than fail-closed surprises. It's the rare control you can
deploy *during* the risk window instead of after it.

### What it maps to

| Advisory behaviour | Payrekha control |
|---|---|
| ₹1-probe → large-value burst | `probe-then-burst` velocity pattern |
| Holiday/weekend/night execution | `calendarFile`-armed `holiday-burst` rules |
| UAT/test keys in prod | `nonprod-key-in-prod` key-origin check |
| New/unseen beneficiary, then drain | `new-beneficiary-burst` + intent binding |
| Insider-held valid credentials | **intent binding** — credential ≠ authorization |
| Reconnaissance before theft | **canary beneficiaries** → `HIGH_ALERT` |

### What it does *not* replace — say this to your board before they do

It is **one layer**, and the runbook says so plainly. It does not replace:
patching, EDR, MFA/PAM, cloud audit logging, egress controls, UAT isolation,
or CERT-In incident reporting. And it **cannot protect payout flows that
bypass the protected gateway** — your coverage boundary is your API surface,
which you must route honestly.

## 3. Deployment architecture & trust boundaries

```
LOS / recon / approver ──signs──▶ intent (Ed25519, expires, amount ceiling)
        │                            │
payout caller ──▶ Envoy ext_authz ──▶ Payrekha gateway ──▶ ALLOW/REVIEW/BLOCK
                        │                    │
                  fail-open on error    decision log (JSONL/CEF) ──▶ SIEM
                                             └─▶ /metrics ──▶ Prometheus
```

| Boundary | What holds it |
|---|---|
| Intent signing | Ed25519 keys — issuer-scoped, revocable (`DELETE /v1/issuers/{keyId}`) |
| Beneficiary privacy | Raw identifiers hashed at edge; only `hb1_` refs stored/logged |
| State integrity | HMAC-signed snapshots — tampering fails load, not silently trusted |
| API access | Role-scoped keys (`evaluate`/`read`/`mint`/`outcomes`/admin) |
| Trusted identity | Envoy `ext_authz` injects caller identity; gateway trusts the header only from its own proxy |
| `HIGH_ALERT` | Persists across restarts; reset only by authenticated admin — audited |

**Key management:** start with gateway-held mint keys; graduate to signing
in your KMS/HSM — same payload, your key custody.

## 4. This week — the four-step plan

| Step | Time | Posture | You get |
|---|---|---|---|
| **Replay** | ~30 min | offline, laptop | what it *would* have caught in your own history + your false-positive baseline |
| **Shadow** | ~1 day | observe-only, fail-open | live would-stop evidence + canaries armed for the holiday window |
| **Advise** | wk 2–3 | verdicts to payout service | ops reviews holds; tuning continues |
| **Enforce** | per kind | active hold/decline | the guarantee, where you choose it |

This week's concrete path: [try-this-weekend.md](try-this-weekend.md) —
your team can run it; it's written for them.

## 5. Compliance & audit evidence

Deploying Payrekha generates the artefacts an auditor asks for *after* an
advisory response:

- **Decision log** — every evaluation recorded (JSONL or **CEF** for
  ArcSight-style SIEMs), with verdict, rules hit, latency, intent binding
- **Audit trail** — every admin/config/canary/reset action logged as
  `type:"audit"` records alongside decisions
- **HIGH_ALERT persistence** — tamper-evident alert state, audited reset
- **Advisory mapping** — [advisory-mapping.md](advisory-mapping.md) maps
  each observed technique to a rule, so your *"what did we do about
  CIAD-2026-0058"* answer is a document, not a scramble
- **SIEM shipper** — `deploy/siem/vector.toml` feeds decisions to your
  existing SOC pipeline

**DPDP note for compliance reviews:** beneficiary PII is hashed at the edge
and never persisted raw — the decision log is DPDP-light by construction.

## 6. Incident playbook — when a canary trips or HIGH_ALERT fires

1. **Do not reset first.** `HIGH_ALERT` is evidence — pull
   `GET /v1/decisions?verdict=BLOCK` and the `canary.tripped` records first.
2. **Identify the caller** — `x-client-id` + sourceKeyId on the record show
   which credential attempted a payout to a trap beneficiary.
3. **Revoke the issuer/credential** — `DELETE /v1/issuers/{keyId}` kills the
   signing side; revoke the service key at your API gateway.
4. **Scope** — `GET /v1/audit` shows every config/state change around it.
5. **Report per CERT-In norms** — the decision log *is* your evidence pack.
6. **Reset only when clean** — `PUT /v1/state` with `{"highAlert":"reset"}`
   under admin auth; the reset itself is audited.

## 7. Future-proofing — what you're building toward

The durable asset isn't the rules engine — it's **intent signing as a
control**. Once your system of record signs payout intents, you get a
property that survives every future campaign: *authorization lives in the
business layer, not in credentials.* That holds whether next quarter's
attack uses phished keys, vendor VPNs, or a compromised CI runner. The
thresholds tune; the intent primitive doesn't age.

## 8. Your honest assessment for leadership

> "We deployed a compensating control at the payout layer in watch-only
> mode — it cannot affect customers. It covers the advisory's credential-
> based intrusion pattern that our perimeter can't see, and produces the
> audit evidence we'll be asked for. It's alpha-grade — we're tuning before
> enforcing — but the alternative this week was watching blind."

That last line is the real answer: the choice wasn't Payrekha vs a mature
vendor — it was visibility vs none, during the window.
