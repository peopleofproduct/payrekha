// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { awsKmsSigner, gcpKmsSigner, pkcs11Signer, _sigv4 } from '../kms.js';
import { signIntentWith, ed25519PrivateKeyFromSeed, intentSigningPayload, verifyIntent } from '../index.js';
import { sign as edSign } from 'node:crypto';

const vec = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../vectors/intent-v1.json'), 'utf8'));
const priv = ed25519PrivateKeyFromSeed(Buffer.from(vec.ed25519SeedHex, 'hex'));

test('AWS SigV4: known sha256/hmac chain values', () => {
  assert.equal(_sigv4.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  // The AWS-blessed signature derivation chain: kDate → kRegion → kService → kSigning.
  let k = _sigv4.hmac('AWS4wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830');
  k = _sigv4.hmac(k, 'us-east-1');
  k = _sigv4.hmac(k, 'iam');
  k = _sigv4.hmac(k, 'aws4_request');
  assert.equal(
    k.toString('hex'),
    'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9',
  );
});

test('awsKmsSigner sends the payload to TrentService.Sign and returns the sig', async () => {
  const seen = {};
  const signer = awsKmsSigner({
    keyId: 'arn:aws:kms:ap-south-1:111122223333:key/abc',
    region: 'ap-south-1',
    credentials: { accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN' },
    fetchImpl: async (url, init) => {
      seen.url = url;
      seen.auth = init.headers.authorization;
      seen.token = init.headers['x-amz-security-token'];
      seen.body = JSON.parse(init.body);
      return new Response(JSON.stringify({ Signature: Buffer.from('fakesig').toString('base64') }), { status: 200 });
    },
  });
  const out = await signer(Buffer.from('hello'));
  assert.equal(out.toString(), 'fakesig');
  assert.equal(seen.url, 'https://kms.ap-south-1.amazonaws.com/');
  assert.equal(seen.body.KeyId, 'arn:aws:kms:ap-south-1:111122223333:key/abc');
  assert.equal(seen.body.SigningAlgorithm, 'ED25519');
  assert.match(seen.auth, /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/ap-south-1\/kms\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target, Signature=[0-9a-f]{64}$/);
  assert.equal(seen.token, 'TOKEN');
});

test('end-to-end: intent signed via a KMS-shaped adapter verifies', async () => {
  // A real KMS returns its own signature; here the mock delegates to the
  // local ed25519 key — proves the seam end-to-end including base64 plumb.
  const signer = pkcs11Signer({ sign: async (payload) => edSign(null, payload, priv) });
  const intent = await signIntentWith(vec.intent, signer);
  assert.equal(intent.signature, vec.ed25519Signature);
  assert.equal(verifyIntent(intent, vec.ed25519PublicKey), true);
});

test('gcpKmsSigner calls asymmetricSign with base64 data', async () => {
  const seen = {};
  const signer = gcpKmsSigner({
    keyName: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1',
    accessToken: 'ya29.x',
    fetchImpl: async (url, init) => {
      seen.url = url;
      seen.auth = init.headers.authorization;
      seen.body = JSON.parse(init.body);
      return new Response(JSON.stringify({ signature: Buffer.from('g').toString('base64') }), { status: 200 });
    },
  });
  const out = await signer(Buffer.from('payload'));
  assert.equal(out.toString(), 'g');
  assert.match(seen.url, /:asymmetricSign$/);
  assert.equal(seen.auth, 'Bearer ya29.x');
  assert.equal(seen.body.data, Buffer.from('payload').toString('base64'));
  assert.equal(seen.body.digest, undefined); // Ed25519 signs raw data, never a digest
});
