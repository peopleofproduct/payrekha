# Signing intents from a KMS/HSM — the private key never leaves

The strongest answer to "who can authorise a payout" is: **nobody who
doesn't hold the issuer key — and the key lives in a KMS.** PayRekha only
ever stores the _public_ key, so a compromised gateway, payout service, or
connector can never mint intents.

`@payrekha/client/kms` ships zero-dependency adapters; every one plugs
into `signIntentWith(intent, signer)` — the signer sees the payload bytes
and returns the signature. Key material never enters your process.

```js
import { signIntentWith } from '@payrekha/client';
import { awsKmsSigner } from '@payrekha/client/kms';

const signer = awsKmsSigner({
  keyId: 'arn:aws:kms:ap-south-1:111122223333:key/…',
  region: 'ap-south-1',
  credentials: { accessKeyId, secretAccessKey, sessionToken }, // IRSA/env
});
const intent = await signIntentWith(unsignedIntent, signer);
await client.registerIntent(intent);
```

## AWS KMS

- **Key**: `SIGN_VERIFY` usage, **`KeySpec: ED25519`** — raw-message Ed25519
  signing. (`ECC_NIST_EDWARDS25519` in older API docs.)
- **API**: `TrentService.Sign` JSON-RPC with `MessageType: RAW` and
  `SigningAlgorithm: ED25519`. Ed25519 signs the message, not a digest —
  the adapter sends the canonical payload base64'd.
- **Auth**: SigV4 over `node:crypto` — no AWS SDK dependency. Feed ambient
  credentials (IRSA, instance profile, `AWS_*` envs); never hardcode.
- **IAM**: least-privilege — `kms:Sign` on the one key ARN, plus
  `kms:GetPublicKey` for bootstrapping. The calling role does **not** need
  `kms:CreateKey` or decrypt permissions.
- Register `keyId` in `payrekha.json` `issuers[]` with the SPKI base64
  from `kms get-public-key`.

## GCP Cloud KMS

- **Key**: `EC_SIGN_ED25519` asymmetric key (CMEK or software HSM level —
  `HSM` protection level for the regulated posture).
- **API**: `projects/…/cryptoKeyVersions/N:asymmetricSign` — for Ed25519
  the request takes `data` (raw message base64), **not** `digest`.
- **Auth**: a Bearer token with `cloudkms.asymmetricSign` — from the GCE
  metadata server, Workload Identity, or `gcloud auth application-default
print-access-token`. The adapter never handles key material.

## PKCS#11 / HSM

`pkcs11Signer({ sign })` wraps any callable — `pkcs11js`, `graphene-pk11`,
SoftHSM for staging, a vendor SDK, or a local signing microservice:

```js
const signer = pkcs11Signer({
  sign: (payload) => session.sign({ mechanism: 'EDDSA' }, keyHandle, payload),
});
```

The HSM mechanism for Ed25519 is `EDDSA` (RFC 8032); ensure the slot/key
is marked non-exportable at creation time.

## Conformance

`clients/js/test/kms.test.mjs` covers: the AWS-published SigV4
key-derivation vector, the SigV4 request shape (signed headers, session
token, TrentService target), and an end-to-end intent signed through the
seam verified against `clients/vectors/intent-v1.json`. The private key
is asserted to never appear in-process — the mock signer delegates to a
local key only in the test.

## Rotating the KMS key

1. Create the new KMS key version / key.
2. Register the new `keyId` → new-public-key mapping in `issuers[]`
   (multi-key keyring — both verify during overlap).
3. Cut signers to the new key id; revoke the old `keyId` after the last
   outstanding intent expires (`DELETE /v1/issuers/:keyId`, or
   `notAfterMs` in config).

## What this does NOT cover

- The **payout service's API key** to PayRekha is a bearer credential —
  scope it (`evaluate` role only), store it in your secret manager.
- Mint (`/v1/intents/mint`) signs server-side — fine for pilots; the KMS
  path is strictly stronger because the key never touches the gateway.
- HSM custody/separation-of-duties (CIO approval for key ceremony) is an
  organisational control — `kits/crypto` shows the m-of-n _technical_
  maker-checker that complements it.
