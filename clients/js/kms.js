// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// @payrekha/client/kms — Ed25519 intent signing where the private key never
// leaves the KMS. Each factory returns an IntentSignerFn for
// signIntentWith(); only payload bytes cross the wire.
//
// Zero-dependency: AWS uses a hand-rolled SigV4 signer (node:crypto only),
// GCP uses a caller-supplied bearer token (your metadata server / workload
// identity already vends one). Both are thin — adapt freely.

import { createHmac, createHash } from 'node:crypto';

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data, enc) => createHmac('sha256', key).update(data).digest(enc);

// ---------------------------------------------------------------------------
// AWS KMS — Sign API with KeySpec ED25519 + RAW message type.
// ---------------------------------------------------------------------------

/**
 * AWS KMS signer. `credentials` = { accessKeyId, secretAccessKey, sessionToken? }
 * — feed it ambient credentials (IRSA, instance profile, env), never hardcode.
 *
 *   const signer = awsKmsSigner({
 *     keyId: 'arn:aws:kms:ap-south-1:111122223333:key/abc',
 *     region: 'ap-south-1',
 *     credentials: { accessKeyId, secretAccessKey, sessionToken },
 *   });
 *   const intent = await signIntentWith(unsigned, signer);
 *
 * The KMS key must be a SIGN_VERIFY key with KeySpec ED25519; SigningAlgorithm
 * ED25519 signs the raw message (KMS Ed25519 does not take a pre-hashed digest).
 */
export function awsKmsSigner({ keyId, region, credentials, endpoint, fetchImpl }) {
  if (!keyId || !region || !credentials?.accessKeyId) {
    throw new TypeError('awsKmsSigner needs { keyId, region, credentials }');
  }
  const fetch_ = fetchImpl ?? globalThis.fetch;
  const host = endpoint ?? `kms.${region}.amazonaws.com`;
  const service = 'kms';
  const { accessKeyId, secretAccessKey, sessionToken } = credentials;

  return async (payload) => {
    const body = JSON.stringify({
      KeyId: keyId,
      Message: Buffer.from(payload).toString('base64'),
      MessageType: 'RAW',
      SigningAlgorithm: 'ED25519',
    });
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const dateStamp = amzDate.slice(0, 8);

    const headers = {
      'content-type': 'application/x-amz-json-1.1',
      host,
      'x-amz-date': amzDate,
      'x-amz-target': 'TrentService.Sign',
      ...(sessionToken !== undefined ? { 'x-amz-security-token': sessionToken } : {}),
    };
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headers[k].trim()}\n`).join('');
    const canonicalRequest = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      signedHeaderNames.join(';'),
      sha256Hex(body),
    ].join('\n');
    const scope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`;

    let key = hmac(`AWS4${secretAccessKey}`, dateStamp);
    key = hmac(key, region);
    key = hmac(key, service);
    key = hmac(key, 'aws4_request');
    const signature = hmac(key, stringToSign, 'hex');

    const res = await fetch_(`https://${host}/`, {
      method: 'POST',
      headers: {
        ...headers,
        authorization:
          `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
          `SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`kms Sign ${res.status}: ${json.message ?? json.__type ?? res.statusText}`);
    return Buffer.from(json.Signature, 'base64');
  };
}

// ---------------------------------------------------------------------------
// GCP Cloud KMS — asymmetricSign on an EC_SIGN_ED25519 key version.
// ---------------------------------------------------------------------------

/**
 * GCP Cloud KMS signer. `keyName` is the full cryptoKeyVersion resource:
 *   projects/P/locations/L/keyRings/R/cryptoKeys/K/cryptoKeyVersions/1
 * `accessToken` — a Bearer token with cloudkms.asymmetricSign (from your
 * metadata server, Workload Identity, or `gcloud auth application-default
 * print-access-token`). The signer never sees the key material.
 */
export function gcpKmsSigner({ keyName, accessToken, fetchImpl }) {
  if (!keyName || !accessToken) throw new TypeError('gcpKmsSigner needs { keyName, accessToken }');
  const fetch_ = fetchImpl ?? globalThis.fetch;
  return async (payload) => {
    // Ed25519 in Cloud KMS signs the raw message (not a digest) — the REST
    // API takes `data` (base64) for EC_SIGN_ED25519.
    const res = await fetch_(`https://cloudkms.googleapis.com/v1/${keyName}:asymmetricSign`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ data: Buffer.from(payload).toString('base64') }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`gcp asymmetricSign ${res.status}: ${json.error?.message ?? res.statusText}`);
    return Buffer.from(json.signature, 'base64');
  };
}

// ---------------------------------------------------------------------------
// PKCS#11 / HSM — plugin seam (we stay zero-dep; you supply the binding).
// ---------------------------------------------------------------------------

/**
 * Wrap any callable that signs with an HSM-resident Ed25519 key —
 * `pkcs11js`, `graphene-pk11`, `softhsm`, a vendor SDK, or a local signing
 * microservice. We adapt the shape; your binding keeps the key.
 *
 *   const signer = pkcs11Signer({ sign: (payload) => session.sign(
 *     { mechanism: 'EDDSA' }, keyHandle, payload) });
 */
export function pkcs11Signer({ sign }) {
  if (typeof sign !== 'function') throw new TypeError('pkcs11Signer needs { sign: fn(payload) }');
  return (payload) => sign(payload);
}

// ---------------------------------------------------------------------------
// HashiCorp Vault transit — the key never leaves Vault; we POST the payload.
// ---------------------------------------------------------------------------

/**
 *   const signer = vaultTransitSigner({
 *     addr: 'https://vault.internal:8200', mount: 'transit', key: 'payrekha-issuer',
 *     token: process.env.VAULT_TOKEN,           // or tokenFn: async () => readToken()
 *   });
 * Transit sign returns "vault:v1:<base64-sig>"; Ed25519 signs the raw message.
 */
export function vaultTransitSigner({ addr, mount = 'transit', key, token, tokenFn, fetchImpl }) {
  if (!addr || !key || (token === undefined && tokenFn === undefined)) {
    throw new TypeError('vaultTransitSigner needs { addr, key, token|tokenFn }');
  }
  const fetch_ = fetchImpl ?? globalThis.fetch;
  return async (payload) => {
    const tok = token ?? (await tokenFn());
    const r = await fetch_(`${addr}/v1/${mount}/sign/${key}`, {
      method: 'POST',
      headers: { 'x-vault-token': tok, 'content-type': 'application/json' },
      body: JSON.stringify({ input: Buffer.from(payload).toString('base64') }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`vault transit sign: ${r.status} ${JSON.stringify(j.errors ?? j).slice(0, 200)}`);
    const sig = String(j.data.signature); // "vault:vN:<b64>"
    return Buffer.from(sig.slice(sig.indexOf(':', sig.indexOf(':') + 1) + 1), 'base64');
  };
}

// ---------------------------------------------------------------------------
// Azure Key Vault — REST sign over a managed-identity or caller token.
// ---------------------------------------------------------------------------

/**
 *   const signer = azureKeyVaultSigner({
 *     vault: 'https://kv-payrekha.vault.azure.net', keyName: 'issuer-1', keyVersion: 'abc123',
 *     tokenFn: async () => getToken(),          // e.g. DefaultAzureCredential.getToken('https://vault.azure.net/.default')
 *   });
 * Azure EdDSA signs the raw message (unlike RSA algs it takes no digest).
 */
export function azureKeyVaultSigner({ vault, keyName, keyVersion, tokenFn, fetchImpl }) {
  if (!vault || !keyName || typeof tokenFn !== 'function') {
    throw new TypeError('azureKeyVaultSigner needs { vault, keyName, tokenFn }');
  }
  const fetch_ = fetchImpl ?? globalThis.fetch;
  const path = keyVersion !== undefined ? `keys/${keyName}/${keyVersion}` : `keys/${keyName}`;
  return async (payload) => {
    const r = await fetch_(`${vault}/${path}/sign?api-version=7.4`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await tokenFn()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ alg: 'EdDSA', value: Buffer.from(payload).toString('base64url') }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`azure kv sign: ${r.status} ${JSON.stringify(j.error ?? j).slice(0, 200)}`);
    return Buffer.from(j.value, 'base64url');
  };
}

// Exported for tests — the SigV4 pieces are the error-prone part, so they
// get their own vector coverage.
export const _sigv4 = { sha256Hex, hmac };
