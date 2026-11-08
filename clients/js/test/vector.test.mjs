// SPDX-License-Identifier: Apache-2.0
// Conformance against clients/vectors/intent-v1.json — the same file the
// Java, Go, and Python signers verify against. If this passes, signatures
// produced here verify in @payrekha/core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  beneficiaryPreimage,
  canonicalJson,
  ed25519PrivateKeyFromSeed,
  exportPublicKey,
  hashBeneficiary,
  intentSigningPayload,
  signIntent,
  signIntentWith,
  verifyIntent,
} from '../index.js';

const vec = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../vectors/intent-v1.json'), 'utf8'));

test('beneficiaryRef via keyed HMAC', () => {
  assert.equal(hashBeneficiary(vec.beneficiary, vec.hashKey), vec.intent.beneficiaryRef);
});

test('canonical payload', () => {
  assert.equal(intentSigningPayload(vec.intent).toString('utf8'), vec.payload);
});

test('hmac-sha256 signature', () => {
  const { intentId } = vec.intent;
  void intentId;
  const signed = signIntent(vec.intent, { alg: 'hmac-sha256', secret: vec.hmacSecret });
  assert.equal(signed.signature, vec.hmacSignature);
});

test('ed25519 signature + public key', () => {
  const priv = ed25519PrivateKeyFromSeed(Buffer.from(vec.ed25519SeedHex, 'hex'));
  assert.equal(exportPublicKey(priv), vec.ed25519PublicKey);
  const signed = signIntent(vec.intent, { alg: 'ed25519', privateKey: priv });
  assert.equal(signed.signature, vec.ed25519Signature);
  assert.equal(verifyIntent(signed, vec.ed25519PublicKey), true);
});

test('signIntentWith seam produces the same signature (KMS/HSM plug point)', async () => {
  const priv = ed25519PrivateKeyFromSeed(Buffer.from(vec.ed25519SeedHex, 'hex'));
  const signed = await signIntentWith(vec.intent, async (payload) => {
    const { sign } = await import('node:crypto');
    return sign(null, payload, priv);
  });
  assert.equal(signed.signature, vec.ed25519Signature);
});

test('floats rejected, integers only', () => {
  assert.throws(() => canonicalJson({ a: 1.5 }), /floats/);
  assert.throws(() => canonicalJson({ a: Number.MAX_SAFE_INTEGER + 1 }), /safe/);
});

test('beneficiaryPreimage normalizes per identifier shape', () => {
  assert.equal(
    beneficiaryPreimage({ account: '1234567890', ifsc: 'hdfc0001234' }),
    'acct:1234567890|HDFC0001234',
  );
  assert.equal(beneficiaryPreimage({ vpa: 'Name@OkHdfc' }), 'vpa:name@okhdfc');
  assert.equal(beneficiaryPreimage({ mobile: '+91 98765 43210' }), 'mob:9876543210');
  assert.equal(
    beneficiaryPreimage({ address: '0xAbC', network: 'ETH' }),
    'vda:eth:0xAbC',
  );
  assert.throws(() => beneficiaryPreimage({}), /required/);
  assert.throws(() => beneficiaryPreimage({ account: '123', ifsc: 'HDFC0001234' }), /6–20/);
  assert.throws(() => beneficiaryPreimage({ mobile: '12345' }), /10-digit/);
});
