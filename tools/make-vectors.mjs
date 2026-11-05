// Regenerates clients/vectors/intent-v1.json: the shared signing vector every client (TS, Java, Python) must reproduce.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ed25519PrivateKeyFromSeed, exportPublicKey, hashBeneficiary, intentSigningPayload, signIntent } from '@payrekha/core';

const seed = createHash('sha256').update('payrekha-test-vector-seed-v1').digest();
const priv = ed25519PrivateKeyFromSeed(seed);
const intent = {
  intentId: 'loan-2026-000042-disb',
  kind: 'LOAN_DISBURSAL',
  maxAmountPaise: 49999900,
  beneficiaryRef: hashBeneficiary({ account: '000123456789', ifsc: 'HDFC0001234' }, 'vector-hash-key-0123456789abcdef'),
  subjectRef: 'loan-2026-000042',
  maxUses: 1,
  notBeforeMs: 1793766600000,
  expiresAtMs: 1793853000000,
  issuer: 'los-prod',
  keyId: 'los-2026-11',
};
const hmacSecret = 'vector-hmac-secret-0123456789abcdef';
const vec = {
  note: 'Test vector only. Never use these keys outside tests.',
  hashKey: 'vector-hash-key-0123456789abcdef',
  beneficiary: { account: '000123456789', ifsc: 'HDFC0001234' },
  intent,
  payload: intentSigningPayload(intent).toString(),
  hmacSecret,
  hmacSignature: signIntent(intent, { alg: 'hmac-sha256', secret: hmacSecret }).signature,
  ed25519SeedHex: seed.toString('hex'),
  ed25519PublicKey: exportPublicKey(priv),
  ed25519Signature: signIntent(intent, { alg: 'ed25519', privateKey: priv }).signature,
};
writeFileSync(new URL('../clients/vectors/intent-v1.json', import.meta.url), JSON.stringify(vec, null, 2) + '\n');
console.log('wrote clients/vectors/intent-v1.json');
