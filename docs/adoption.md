<!-- SPDX-License-Identifier: Apache-2.0 -->

# Adoption ladder — from one API call to HSM-signed intents

PayRekha's guarantee ("no matching intent, no payout") is strongest when the
system of record signs intents with a key it alone holds. That is also the most
work to adopt, so the product offers a ladder: every tier exercises the same
verdicts, dedupe and audit trail; what changes between tiers is **who vouches
for an intent's authenticity**. Move up a tier when the one below proves itself
on your traffic — never sideways.

| Tier                   | Integration effort                                                                                 | Who can mint intents                    | Use for                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------- |
| **0 · Observe**        | One `POST /v1/evaluate` call or the Envoy `ext_authz` filter. No intents.                          | — (intent rules off or shadow)          | Day one: behavioural rules on real traffic      |
| **1 · Managed**        | One extra call: `POST /v1/intents/mint` before each payout.                                        | The PayRekha gateway (holds a mint key) | First enforce-able tier; pilots; low-risk kinds |
| **2 · SDK-signed**     | ~10 lines in Java/Python/Go: hold an Ed25519 key, sign, register.                                  | Your system of record                   | Most production deployments                     |
| **3 · KMS/HSM-signed** | Tier 2 + key never leaves the KMS/HSM.                                                             | Your HSM/KMS                            | Regulated lenders, banking rails                |
| **0-code · Connector** | None on the LOS: it already emits "approved" events. A bridge turns them into mint/register calls. | Connector's key or the gateway mint key | Event-driven stacks (Kafka/SQS/webhooks)        |

## Tier 1 — managed intents (`/v1/intents/mint`)

The caller sends payout-shaped JSON; the gateway builds the intent, signs it
with a configured key and registers it. Raw beneficiary fields are hashed at
entry exactly like `/v1/evaluate` — nothing raw is stored.

```bash
POST /v1/intents/mint            Authorization: Bearer <mint-role key>
{ "kind": "LOAN_DISBURSAL", "amountPaise": 24000000,
  "beneficiary": { "account": "000123456789", "ifsc": "HDFC0001234" },
  "subjectRef": "loan-007", "ttlMs": 300000 }
→ 201 { "accepted": true, "intentId": "mint-Ab3…" }

POST /v1/evaluate              Authorization: Bearer <evaluate-role key>
{ "payoutId": "p-991", "kind": "LOAN_DISBURSAL", "amountPaise": 24000000,
  "beneficiary": { "account": "000123456789", "ifsc": "HDFC0001234" },
  "channel": "IMPS", "intentId": "mint-Ab3…" }
→ 200 { "verdict": "ALLOW", … }
```

- **Idempotent by construction**: identical fields derive the same `intentId`,
  or pass your own (`intentId: "loan-007"` — recommended, use your loan/payout
  id) so retries and replays collapse to one registration.
- **`subjectRef`** carries your reference (loan id, batch id) into the decision
  log — the only echo of your domain inside PayRekha.
- **Config**: issuer entry as usual in `issuers[]`, plus
  `PAYREKHA_MINT_KEY_ID` (the issuer's keyId) and `PAYREKHA_MINT_KEY`
  (PKCS#8 base64 or PEM). `gateway.mint.defaultTtlMs`/`maxTtlMs` bound intent
  lifetime (defaults 5 min / 24 h). Boot **fails** if the key doesn't verify —
  a mismatch can never produce silently-dead mints.
- **Roles**: give the LOS `mint` + `evaluate`, never `intents`. A `mint` key
  cannot register foreign-signed intents; an `intents` key cannot mint. A
  stolen mint key is still bounded by the issuer's `kinds`, the TTL cap and
  the intent store caps — revoke it like any issuer key.
- **Honest trust note**: in this tier PayRekha holds signing power, so a
  compromised gateway could mint. That is the same exposure class as an HMAC
  issuer — acceptable for pilots and shadow→enforce ramps, but external
  signing is the end state for money movement at scale.

### When the mint tier is acceptable — and when it isn't

The guarantee "even if they're inside, the money doesn't leave" rests on the
signing key living in a _different_ trust zone from the payout caller. Mint
moves the signing key onto the PayRekha host — the storey collapses to "one
host must hold" instead of "two keys must collude". Price that honestly:

| Acceptable                                                                     | Not acceptable                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Shadow/advise ramps and pilots                                                 | `enforce` on high-value kinds at scale                        |
| Low-value or rate-capped kinds                                                 | `VDA_WITHDRAWAL` / crypto withdrawals                         |
| Proving the verdict machinery before the LOS team can schedule signing work    | Long-running production with no date for Tier 2               |
| Environments where the gateway is better isolated than the LOS (rare — verify) | Anywhere a mint-role key could sit next to an evaluate caller |

If you do run mint, contain it: `mint` on a dedicated role key (never bundled
with `evaluate` — boot warns on colocated roles), ed25519 only (boot
enforces), tight `defaultTtlMs`/`maxTtlMs`, and the guardrails that bound a
stolen mint key: `gateway.mint.maxAmountPaise` caps every minted intent's
amount, `mintsPerMinute` bounds the signing rate (default 60/min per key),
and `modes: ["shadow","advise"]` makes minting impossible while a kind is
enforced — the strongest containment short of external signing. Issuer
`kinds` scoped to exactly the kinds mint should authorise, and the
`DELETE /v1/issuers/<keyId>` revocation path rehearsed — a mint key is an
issuer key, and revoking it kills every intent it signed instantly. The plan
to move off it (Tier 2 SDK signing) should be a roadmap item with an owner,
not a someday.

## Tier 2 — sign in your system of record

`clients/` has signers for Node (`@payrekha/client` — `npm i`), Java
(+ Spring Boot starter), Python, Go and .NET. The pattern everywhere:

```
unsigned = { intentId: "<your id>", kind, maxAmountPaise,
             beneficiaryRef: hashBeneficiary({account, ifsc | vpa}, HASH_KEY),
             maxUses: 1, notBeforeMs, expiresAtMs, issuer, keyId }
intent   = sign(unsigned, ed25519PrivateKey)      # canonical JSON, domain-tagged
POST /v1/intents (intents role)  →  201
POST /v1/evaluate … "intentId": unsigned.intentId
```

Give PayRekha only `{keyId, issuer, alg, publicKey, kinds}` — the private key
never leaves your system.

## Tier 3 — KMS / HSM

`@payrekha/client/kms` ships ready adapters — `awsKmsSigner` (Ed25519
`SIGN_VERIFY` key, SigV4 over node:crypto, no AWS SDK dep),
`gcpKmsSigner` (`EC_SIGN_ED25519` key version, Bearer token), and
`pkcs11Signer` (any HSM/vendor binding). Full recipes in
[docs/kms.md](kms.md):

```ts
import { awsKmsSigner } from '@payrekha/client/kms';
const intent = await signIntentWith(unsigned, awsKmsSigner({ keyId: arn, region, credentials }));
```

(The conformance vectors in `clients/vectors` prove any signer against the
same bytes — `clients/js/test/kms.test.mjs` asserts the key never enters
the process.)

## Zero-code connector

If your LOS emits approval events already, you need no LOS code at all.
`connectors/` productises the bridge: webhook / Kafka / SQS receivers
sharing one field-map engine, `docker run`-able, with LOS-disbursal and
PA-settlement reference maps:

```
PAYREKHA_URL=… PAYREKHA_MINT_TOKEN=… FIELD_MAP_FILE=fieldmaps/los-disbursal.json \
  node connectors/webhook.mjs        # or kafka.mjs / sqs.mjs
```

`examples/intent-bridge.mjs` remains the 40-line teaching version. Point
the receiver at `PAYREKHA_URL` + a `mint`-role key, keep your existing
event schema, set `fieldMap` in one place. The bridge can equally call
`/v1/intents` with its own signer — same wire, one tier up.

## Graduation checklist (per intent kind)

1. Tier 0 shadow: verdicts + `would-stop` log reviewed for ≥ 1 week of traffic.
2. Tier 1: `requireIntent` flipped on (still shadow) → intent coverage ≥ 99%.
3. Tier 2/3: external signing live, `mint` role keys revoked.
4. `advise` → `enforce` per kind; `failure_mode_allow: false` at Envoy.

## Edge integrations beyond Envoy

Same `/ext_authz` contract, three more fronts: [NGINX auth_request](integrations/nginx.md) (`deploy/nginx/payrekha.conf`), [Kong plugin](integrations/kong.md) (`deploy/kong/plugins/payrekha`), and [Istio `CUSTOM` authorization](integrations/istio.md) — all fail closed, all assert `x-client-id` at the edge.
