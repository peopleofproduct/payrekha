# Node (in-process)

Run PayRekha inside your payout service. There is no network hop: p99 is about 19 µs.

```ts
import { Payrekha, hashBeneficiary, FileStateStore } from '@payrekha/core';
import { payrekhaRules } from '@payrekha/rules';

const { rules } = payrekhaRules({ velocity: { perSourceKeyOverrides: { 'settlement-svc': { count: 40, sumPaise: 50_000_000_00 } } } });
const fw = new Payrekha(rules, {
  config: { mode: 'shadow', modeByKind: { LOAN_DISBURSAL: 'enforce' } },
  keys: [{ keyId: 'los-2026-11', issuer: 'los', alg: 'ed25519', publicKey: LOS_PUBLIC_KEY_PEM, kinds: ['LOAN_DISBURSAL', 'VERIFICATION'] }],
  adminTokenSha256: ADMIN_SHA256,
});

fw.registerIntent(signedIntentFromLos);
const v = fw.evaluate({
  payoutId: 'po-1', kind: 'LOAN_DISBURSAL', intentId: 'loan-88213', amountPaise: 24_000_000,
  beneficiaryRef: hashBeneficiary({ account: '000123456789', ifsc: 'HDFC0001234' }, HASH_KEY),
  channel: 'IMPS', sourceKeyId: 'lms', origin: 'prod', timestampMs: Date.now(),
});
if (v.effectiveAction !== 'ALLOW') return hold(v);
```

Persist state with the file store (`saveState`/`loadState`) on an interval and on shutdown, as `packages/gateway/src/bin.ts` does.
