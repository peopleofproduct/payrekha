// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// @payrekha/client — zero-dependency client for the PayRekha payout
// firewall. Two halves:
//
//   IntentSigner   — signs intents INSIDE your system of record. The
//                    private key (or KMS handle) never leaves this process;
//                    PayRekha only ever sees the public key.
//   PayrekhaClient — typed HTTP wrapper over the gateway API
//                    (/v1/evaluate, /v1/intents*, /v1/outcomes, …).
//
// Byte-for-byte compatible with @payrekha/core's signIntent() — proven by
// the shared conformance vectors in clients/vectors/.

import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  timingSafeEqual,
  verify as edVerify,
} from 'node:crypto';

export const INTENT_DOMAIN = 'payrekha-intent-v1\n';

export const INTENT_KINDS = ['LOAN_DISBURSAL', 'VDA_WITHDRAWAL', 'REFUND', 'PA_SETTLEMENT', 'VERIFICATION'];

const MAX_SAFE = 9007199254740991;
const INVALID = /[￾￿]/; // non-characters must not be emitted

/** Sorted keys, no whitespace, integers only, null/undefined fields dropped. */
export function canonicalJson(v) {
  const parts = [];
  writeJson(parts, v);
  return parts.join('');
}

function writeJson(out, v) {
  if (v === undefined || v === null) {
    out.push('null');
  } else if (typeof v === 'string') {
    out.push(JSON.stringify(v));
  } else if (typeof v === 'boolean') {
    out.push(String(v));
  } else if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) {
      if (Number.isInteger(v)) throw new TypeError('integer exceeds JS-safe range — use bigint->string path');
      throw new TypeError('floats are not allowed; use integer paise / epoch ms');
    }
    out.push(String(v));
  } else if (typeof v === 'bigint') {
    if (v > BigInt(MAX_SAFE) || v < BigInt(-MAX_SAFE)) throw new TypeError('bigint exceeds JS-safe range');
    out.push(String(v));
  } else if (Array.isArray(v)) {
    out.push('[');
    v.forEach((e, i) => {
      if (i > 0) out.push(',');
      writeJson(out, e);
    });
    out.push(']');
  } else if (typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    out.push('{');
    keys.forEach((k, i) => {
      if (i > 0) out.push(',');
      out.push(JSON.stringify(k), ':');
      writeJson(out, v[k]);
    });
    out.push('}');
  } else {
    throw new TypeError(`cannot canonicalize ${typeof v}`);
  }
  if (INVALID.test(out[out.length - 1])) throw new TypeError('non-character in string');
}

// ---------------------------------------------------------------------------
// beneficiaryRef — HMAC-keyed reference; raw account/IFSC/mobile never leaves.
// ---------------------------------------------------------------------------

const MOBILE = /^(?:\+?91|0)?([6-9]\d{9})$/;

/** 10-digit Indian mobile, or null. */
export function normalizeMobile(input) {
  const m = MOBILE.exec(String(input).replace(/[\s\-()]/g, ''));
  return m?.[1] ?? null;
}

/**
 * Canonical preimage — byte-for-byte the same as core hash.ts.
 * Exactly one identifier shape per call:
 *   { account, ifsc } | { vpa } | { mobile } | { address, network }
 */
export function beneficiaryPreimage(id) {
  if ('account' in id) {
    const account = String(id.account).replace(/[\s-]/g, '');
    const ifsc = String(id.ifsc).trim().toUpperCase();
    if (!/^\d{6,20}$/.test(account)) throw new TypeError('account number must be 6–20 digits');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new TypeError('IFSC must look like ABCD0123456');
    return `acct:${account}|${ifsc}`;
  }
  if ('vpa' in id) {
    const vpa = String(id.vpa).trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/.test(vpa)) throw new TypeError('VPA must look like name@handle');
    return `vpa:${vpa}`;
  }
  if ('mobile' in id) {
    const mobile = normalizeMobile(id.mobile);
    if (mobile === null) throw new TypeError('mobile must be a 10-digit Indian number');
    return `mob:${mobile}`;
  }
  if ('address' in id && 'network' in id) {
    return `vda:${String(id.network).trim().toLowerCase()}:${String(id.address).trim()}`;
  }
  throw new TypeError('a beneficiary identifier is required: {account,ifsc} | {vpa} | {mobile} | {address,network}');
}

export function hashBeneficiary(id, key) {
  if (key.length < 16) throw new RangeError('beneficiary HMAC key must be at least 16 bytes');
  return 'hb1_' + createHmac('sha256', key).update(beneficiaryPreimage(id), 'utf8').digest('base64url');
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Ed25519 private key from a 32-byte seed — deterministic demo/test keys only. */
export function ed25519PrivateKeyFromSeed(seed) {
  if (seed.length !== 32) throw new RangeError('Ed25519 seed must be 32 bytes');
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

export function generateIssuerKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

export function exportPublicKey(key) {
  const pub = key.type === 'private' ? createPublicKey(key) : key;
  return pub.export({ format: 'der', type: 'spki' }).toString('base64');
}

const toPrivateKey = (k) =>
  typeof k !== 'string'
    ? k
    : k.includes('BEGIN')
      ? createPrivateKey(k)
      : createPrivateKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'pkcs8' });

/** Bytes that get signed: domain tag + canonical JSON of every field except `signature`. */
export function intentSigningPayload(intent) {
  const { signature: _ignored, ...rest } = intent;
  void _ignored;
  return Buffer.from(INTENT_DOMAIN + canonicalJson(rest), 'utf8');
}

/**
 * Sign an intent with a local key — ed25519 ({alg:'ed25519', privateKey:
 * PKCS8 base64/PEM/KeyObject}) or hmac-sha256 ({alg:'hmac-sha256', secret}).
 * For a KMS/HSM signer use signIntentWith().
 */
export function signIntent(intent, key) {
  const payload = intentSigningPayload(intent);
  const signature =
    key.alg === 'ed25519'
      ? edSign(null, payload, toPrivateKey(key.privateKey)).toString('base64url')
      : createHmac('sha256', key.secret).update(payload).digest('base64url');
  return { ...intent, signature };
}

/**
 * Sign with an async signer — the seam for KMS/HSM adapters
 * (@payrekha/client/kms) or your own vault call. The signer receives the
 * exact payload bytes and returns the raw signature; the private key never
 * appears in this process.
 *
 *   const intent = await signIntentWith(unsigned, (payload) => kms.sign(payload));
 */
export async function signIntentWith(intent, signer) {
  const sig = await signer(intentSigningPayload(intent));
  return { ...intent, signature: Buffer.from(sig).toString('base64url') };
}

/** Local verify — mostly for tests/demos; the gateway does the real check. */
export function verifyIntent(intent, publicKey) {
  const pub = publicKey.includes('BEGIN')
    ? createPublicKey(publicKey)
    : createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  return edVerify(null, intentSigningPayload(intent), pub, Buffer.from(intent.signature, 'base64url'));
}

// ---------------------------------------------------------------------------
// Gateway client
// ---------------------------------------------------------------------------

export class PayrekhaError extends Error {
  constructor(status, body) {
    super(`payrekha ${status}: ${typeof body === 'object' && body !== null ? (body.error ?? JSON.stringify(body)) : String(body)}`);
    this.name = 'PayrekhaError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Thin typed wrapper over the gateway. One instance per API key role —
 * keys are not interchangeable (evaluate needs a caller key, mint needs a
 * mint-role key, admin ops need the admin key).
 */
export class PayrekhaClient {
  /**
   * @param {object} opts
   * @param {string} opts.url        gateway base URL, no trailing slash needed
   * @param {string} opts.token      API key for the caller's role
   * @param {number} [opts.timeoutMs] default 5000
   * @param {typeof fetch} [opts.fetchImpl] injectable fetch (tests / proxies)
   */
  constructor({ url, token, timeoutMs = 5_000, fetchImpl } = {}) {
    if (!url || !token) throw new TypeError('PayrekhaClient needs { url, token }');
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl ?? globalThis.fetch;
    if (!this.fetch) throw new TypeError('no fetch — pass fetchImpl or use Node ≥18');
  }

  async #call(method, path, body, token) {
    const res = await this.fetch(`${this.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token ?? this.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayrekhaError(res.status, json);
    return json;
  }

  /** Evaluate a payout. Returns { verdict, effectiveAction, reasons, ... }. */
  evaluate(payout, opts = {}) {
    return this.#call('POST', '/v1/evaluate', payout, opts.token);
  }

  /** Mint an intent server-side (mint-role key required). */
  mintIntent(body, opts = {}) {
    return this.#call('POST', '/v1/intents/mint', body, opts.token);
  }

  /** Register an already-signed intent. */
  registerIntent(intent, opts = {}) {
    return this.#call('POST', '/v1/intents', intent, opts.token);
  }

  getIntent(intentId, opts = {}) {
    return this.#call('GET', `/v1/intents/${encodeURIComponent(intentId)}`, undefined, opts.token);
  }

  listIntents(opts = {}) {
    return this.#call('GET', '/v1/intents', undefined, opts.token);
  }

  /** Report the payout outcome — 'settled' | 'failed' | 'cancelled'. */
  outcome(body, opts = {}) {
    return this.#call('POST', '/v1/outcomes', body, opts.token);
  }

  decisions(opts = {}) {
    return this.#call('GET', '/v1/decisions', undefined, opts.token);
  }

  audit(opts = {}) {
    return this.#call('GET', '/v1/audit', undefined, opts.token);
  }

  state(opts = {}) {
    return this.#call('GET', '/v1/state', undefined, opts.token);
  }

  healthz() {
    return this.#call('GET', '/healthz', undefined, this.token).catch(() => this.fetch(`${this.url}/healthz`).then((r) => r.json()));
  }

  readyz() {
    return this.#call('GET', '/readyz', undefined, this.token).catch(() => this.fetch(`${this.url}/readyz`).then((r) => r.json()));
  }
}
