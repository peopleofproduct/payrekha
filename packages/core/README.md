# @payrekha/core

The payout firewall itself — deterministic, synchronous, zero runtime
dependencies. Signed intents bind a payout to its business intent ("no
matching intent, no payout"); the engine, ledgers, canaries, dedupe,
snapshot persistence and HMAC state integrity all live here.

```ts
import { Payrekha, hashBeneficiary } from '@payrekha/core';

const fw = new Payrekha(rules, {
  config: { mode: 'shadow' },
  keys: [{ keyId: 'los-1', issuer: 'los-prod', alg: 'ed25519', publicKey, kinds: ['LOAN_DISBURSAL'] }],
});
const verdict = fw.evaluate(payout); // { verdict, hits, effectiveAction, riskScore, … }
```

Also exports the intent primitives (`signIntent`, `intentSigningPayload`,
`generateIssuerKeyPair`, `Keyring`) used by the Java/Python/Go signing
clients, `hashBeneficiary` for keyed beneficiary refs, and
`FileStateStore`/`signSnapshot`/`verifyAndUnwrap` for persistence.

Apache-2.0.
