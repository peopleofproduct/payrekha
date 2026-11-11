# Access model — who can call what

## Bearer API keys (`PAYREKHA_API_KEYS`)

Format per key: `id:origin:role1,role2:secret`. The gateway stores only
`SHA-256(secret)` — the token itself is never persisted (see
`ApiKey.sha256`, `packages/gateway/src/server.ts`).

| Role       | May call                                                     | Typical holder                                        |
| ---------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| `evaluate` | `POST /v1/evaluate` (+ ext_authz path via edge key)          | payout API / proxy                                    |
| `intents`  | `POST /v1/intents` (register), mint endpoints                | system of record (LOS/settlement engine)              |
| `outcomes` | `POST /v1/outcomes` (settled/failed → release reservations)  | settlement reporter                                   |
| `read`     | `/metrics`, `/v1/decisions`, `/v1/intents` GET               | dashboards, Prometheus                                |
| `admin`    | mode set, alert reset, issuer revocation, canary/feed writes | ops (still requires `PAYREKHA_ADMIN_KEY` — see below) |

Absent `roles` = all roles (legacy); grant narrowly per the doc comment.

**Enforced properties** an auditor can verify in `server.ts`/`config.ts`:

- `sourceKeyId` on a payout is **always the authenticated key id** — a
  caller cannot impersonate another source (the field is overwritten, and
  `sourceHint`/`origin` are deleted or asserted by the edge).
- `origin: prod|nonprod` is a **property of the key**, never the request
  body — prod payouts cannot arrive on a nonprod key.
- `merchantIds` scoping: a key can be restricted to named merchants —
  out-of-scope `merchantId` is refused 403 (PA model; protects shared
  velocity/ledger state).
- Rate limits and a 64KB body cap sit in front of parsing.

## Admin authentication

`/v1/admin/*` and the privileged routes additionally require the admin
bearer token (`authorization: Bearer <PAYREKHA_ADMIN_KEY>`; ≥16 chars
enforced, <32 warns at boot — use ≥32), compared hash-to-hash. Admin
actions are `audit` records in the same decision log — actor is recorded.

## Transport

The listener speaks plain HTTP by default — in the reference topology TLS
terminates at Envoy/ingress and :8080 stays inside the trust zone. For
in-zone encryption set `PAYREKHA_TLS_KEY_FILE` + `PAYREKHA_TLS_CERT_FILE`
(+ `PAYREKHA_TLS_CA_FILE`); `PAYREKHA_TLS_CLIENT_AUTH=required` turns it
into mTLS — health probes and scrapers then need client certs too.

## Issuer signing keys (separate plane)

- Intents are signed by **issuer Ed25519 keys** configured in
  `payrekha.json` (`issuers[]`, `notAfterMs`, revocation via
  `DELETE /v1/issuers/:keyId`). Verifying a signature is separate from
  holding an API key — an attacker needs both planes.
- Managed minting (`gateway.mint`) requires `PAYREKHA_MINT_KEY{,_ID}`;
  at boot the gateway **proves the key verifies** against the configured
  issuer before serving — a misconfigured mint key fails startup, not the
  first real mint.
- HSM/KMS: private keys never need to live in PayRekha — `../kms.md`
  (AWS KMS, GCP Cloud KMS, PKCS#11 seam); the payload contract is
  unchanged.
- All privileged files the generator writes (`.env`, `issuer-keys.json`)
  are mode `0600` (`bin/payrekha.mjs`).

## What is NOT PayRekha's job (operator boundary)

mTLS/NetworkPolicy at the edge, Postgres access control, OS/container
hardening, and secret-manager IAM — Helm chart ships sane defaults
(default-deny egress, non-root, read-only fs) but the environment is the
operator's perimeter.
