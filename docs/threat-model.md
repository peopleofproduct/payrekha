# Threat model

## What Payrekha assumes

- The attacker is **inside**. They hold valid API credentials for the payout service, can call it from inside the network, and may own a UAT box, a CI runner or a developer laptop (CIAD-2026-0058's CRAFTY FALCON).
- The intent-signing key lives in a **different** trust zone from the payout service: the LOS or settlement engine, ideally in an HSM or KMS.
- Payrekha sits on the only path to the bank: an Envoy ext_authz filter with `failure_mode_allow: false`, or an SDK call the payout code cannot skip.
- Operators protect the admin token and the beneficiary hash key.

## What an attacker can and cannot do

| Attacker has | Can they move money? | What stops them |
|---|---|---|
| A stolen payout API key | No, not for intent-required kinds | `intent.missing` |
| A real intent, replayed to their own account | No | `intent.beneficiary-mismatch`, `intent.reused` |
| A real intent, with the amount inflated | No | `intent.amount-exceeds` |
| A refund-signing key, used to mint a disbursal | No | `intent.kind-mismatch` (keys are scoped to kinds) |
| A UAT/staging key or box | No | `origin.nonprod`; the origin comes from the key, not the request body |
| A stolen payout key minting intents or reading state | No | Role-scoped keys (`evaluate`/`outcomes`/`intents`/`read`); a payout key holds only `evaluate` |
| A stolen payout key reporting `failed` on another caller's payout to free its intent | No | Outcome reports are bound to the evaluating `sourceKeyId`; denials are audited |
| Replaying a taken `payoutId` under a fresh intent to dodge `intent.reused` | No | A `payoutId` is bound to one intent for life, even across restarts (reservations persist) |
| A forged `timestampMs` that backdates cooling or fast-forwards the block-burst window | No | The gateway stamps server time; the caller's value is `clientTimestampMs` evidence and `maxTimestampSkewMs` degrades wild claims to REVIEW (`time.skew`) |
| Control of a merchant's settlement account | Delayed: REVIEW | `settlement.account-changed`, `settlement.over-captured` |
| Small test transfers before a big one | Delayed: REVIEW, then BLOCK in HIGH_ALERT | `probe.micro-then-large` |
| A burst on a holiday night | Tighter budgets | `calendar.window` multipliers, `velocity.outflow` |
| Touched a canary | No, and the system goes into HIGH_ALERT | `canary.tripped` |
| **The intent-signing key itself** | **Yes, within the issuer's kinds** | Velocity, cooling, probes, canaries still apply; revoke the key |
| **The Payrekha admin token** | They can switch to shadow mode | The mode change is logged and metrics show it; keep the token in a vault and alert on `PUT /v1/state` |
| The ability to bypass Payrekha on the network path | Yes | Out of scope: enforce the path with network policy |

## Payrekha's own hardening

- Container runs as non-root with a read-only root filesystem, `cap_drop: ALL` and `no-new-privileges`.
- Bearer tokens are held as SHA-256 hashes and compared in constant time. Admin operations use a separate token and require a reason. Caller-supplied identity fields (`origin`, `sourceKeyId`, `timestampMs`) never come from the request body — `timestampMs` is stamped at the gateway unless the caller is explicitly trusted.
- HIGH_ALERT persists across restarts and only clears with an authenticated reset. The advisory says to assume the attacker persists.
- Restoring a state snapshot cannot change the configured mode.
- Malformed input and rule exceptions become a degraded REVIEW, never an ALLOW.
- No raw beneficiary identifiers in state or logs. Webhooks are HMAC-signed and never delay a verdict.
- Core and rules make no network calls; the gateway only calls the webhook you configure.
