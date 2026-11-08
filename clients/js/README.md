# @payrekha/client

Zero-dependency Node client for the PayRekha payout firewall. Two halves:

- **`signIntent` / `signIntentWith`** — sign intents *inside* your system of
  record (LOS/LMS, settlement engine). The Ed25519 private key — or the KMS
  handle — never leaves this process; PayRekha only ever holds the public key.
- **`PayrekhaClient`** — typed wrapper over the gateway API.

Byte-for-byte signature-compatible with `@payrekha/core` — proven against the
shared vectors in `clients/vectors/` by the same test file the Java/Go/Python
signers run.

```bash
npm i @payrekha/client   # Node ≥ 18, no dependencies
```

## Sign + register an intent

```js
import { generateIssuerKeyPair, hashBeneficiary, signIntent, PayrekhaClient } from '@payrekha/client';

// once: the keypair lives in your SoR; the public key is registered in PayRekha config
const { publicKey, privateKey } = generateIssuerKeyPair();

const beneficiaryRef = hashBeneficiary(
  { account: '123456789012', ifsc: 'HDFC0001234' },
  process.env.PAYREKHA_HASH_KEY,          // ≥16 bytes, same key the gateway uses
);

const intent = signIntent(
  {
    intentId: 'loan-2026-000042-disb',    // reuse your own id — retries collapse
    kind: 'LOAN_DISBURSAL',
    maxAmountPaise: 49_999_900,
    beneficiaryRef,
    subjectRef: 'loan-2026-000042',
    maxUses: 1,
    notBeforeMs: Date.now(),
    expiresAtMs: Date.now() + 24 * 3_600_000,
    issuer: 'los-prod',
    keyId: 'los-2026-11',
  },
  { alg: 'ed25519', privateKey },
);

const client = new PayrekhaClient({ url: 'http://payrekha:8080', token: MINT_OR_INTENT_KEY });
await client.registerIntent(intent);
```

## Evaluate at payout time

```js
const verdict = await client.evaluate({
  payoutId: 'po-9f2c…',
  kind: 'LOAN_DISBURSAL',
  intentId: intent.intentId,
  amountPaise: 49_999_900,
  beneficiaryRef,
  channel: 'IMPS',
  sourceKeyId: 'lms',
  origin: 'prod',
  timestampMs: Date.now(),
});
// verdict.effectiveAction: 'ALLOW' | 'HOLD' | 'DECLINE' (mode applied)
// verdict.hits: rule evidence for the decision log
await client.outcome({ payoutId: 'po-9f2c…', outcome: 'settled' });
```

## KMS / HSM signing

`signIntentWith(intent, signer)` takes any async signer that maps
payload bytes → signature bytes. `@payrekha/client/kms` ships adapters:

```js
import { awsKmsSigner, gcpKmsSigner, pkcs11Signer } from '@payrekha/client/kms';

const intent = await signIntentWith(unsigned, awsKmsSigner({
  keyId: 'arn:aws:kms:ap-south-1:…:key/…', region: 'ap-south-1',
  credentials: { accessKeyId, secretAccessKey, sessionToken },   // IRSA/env — never hardcode
}));
// GCP: gcpKmsSigner({ keyName: 'projects/…/cryptoKeyVersions/1', accessToken })
// HSM: pkcs11Signer({ sign: (payload) => session.sign({ mechanism:'EDDSA' }, key, payload) })
```

AWS needs a `SIGN_VERIFY` KMS key with `KeySpec: ED25519` (raw-message
signing); GCP needs an `EC_SIGN_ED25519` cryptoKeyVersion. See
`docs/kms.md` for the full recipes.

## Notes

- The mint path (`client.mintIntent`) is server-side signing for
  pilots — prefer `signIntent`/`signIntentWith` in production so the key
  never touches the firewall host.
- One client per role: evaluate needs a caller key, mint a mint-role key,
  admin ops the admin key.
- Every method takes `{ token }` to override per call.
