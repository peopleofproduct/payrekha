// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  timingSafeEqual,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';
import { canonicalJson } from './canonical.js';
import { looksLikeRawIdentifier } from './hash.js';
import { INTENT_KINDS, type Intent, type IntentKind } from './types.js';

/** Domain separator: an intent signature can never be replayed as another message type. */
export const INTENT_DOMAIN = 'payrekha-intent-v1\n';

export type UnsignedIntent = Omit<Intent, 'signature'>;
export type SigningAlg = 'ed25519' | 'hmac-sha256';

/** Bytes that get signed: domain tag + canonical JSON of every field except `signature`. */
export function intentSigningPayload(intent: UnsignedIntent | Intent): Buffer {
  const { signature: _ignored, ...rest } = intent as Intent;
  void _ignored;
  return Buffer.from(INTENT_DOMAIN + canonicalJson(rest), 'utf8');
}

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Ed25519 private key from a 32-byte seed — for deterministic demo/test keys only. */
export function ed25519PrivateKeyFromSeed(seed: Buffer): KeyObject {
  if (seed.length !== 32) throw new RangeError('Ed25519 seed must be 32 bytes');
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

export interface IssuerKeyPair {
  /** SPKI DER, base64. Give this to PayRekha. */
  readonly publicKey: string;
  /** PKCS#8 DER, base64. Keep this inside the system of record (HSM/KMS ideally). */
  readonly privateKey: string;
}

export function generateIssuerKeyPair(): IssuerKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

/** SPKI-DER base64 of an Ed25519 public key. */
export function exportPublicKey(key: KeyObject): string {
  const pub = key.type === 'private' ? createPublicKey(key) : key;
  return pub.export({ format: 'der', type: 'spki' }).toString('base64');
}

const toPrivateKey = (k: string | KeyObject): KeyObject =>
  typeof k !== 'string'
    ? k
    : k.includes('BEGIN')
      ? createPrivateKey(k)
      : createPrivateKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'pkcs8' });

const toPublicKey = (k: string): KeyObject =>
  k.includes('BEGIN') ? createPublicKey(k) : createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' });

export type SignerKey =
  | { readonly alg: 'ed25519'; readonly privateKey: string | KeyObject }
  | { readonly alg: 'hmac-sha256'; readonly secret: string };

/** Sign an intent. Runs in the system of record (LOS/LMS, settlement engine), not in PayRekha. */
export function signIntent(intent: UnsignedIntent, key: SignerKey): Intent {
  const payload = intentSigningPayload(intent);
  const signature =
    key.alg === 'ed25519'
      ? edSign(null, payload, toPrivateKey(key.privateKey)).toString('base64url')
      : createHmac('sha256', key.secret).update(payload).digest('base64url');
  return { ...intent, signature };
}

/** One issuer verification key. */
export interface IssuerKey {
  readonly keyId: string;
  readonly issuer: string;
  readonly alg: SigningAlg;
  /** Ed25519: SPKI DER base64 or PEM. */
  readonly publicKey?: string;
  /**
   * HMAC: the shared secret. Anyone holding it can mint intents — including
   * a compromised PayRekha host. Prefer Ed25519; see docs/intents.md.
   */
  readonly secret?: string;
  /** Intent kinds this issuer may authorise. Omitted = none (fail closed). */
  readonly kinds: readonly IntentKind[];
  /** Rotation: intents signed by this key stop verifying after this instant. */
  readonly notAfterMs?: number;
  readonly revoked?: boolean;
}

export type VerifyFailure = 'unknown-key' | 'issuer-mismatch' | 'kind-not-allowed' | 'key-expired' | 'key-revoked' | 'bad-signature';
export type VerifyResult = { readonly ok: true } | { readonly ok: false; readonly reason: VerifyFailure };

/**
 * Public keys of the systems allowed to authorise payouts. PayRekha holds
 * only public keys (Ed25519), so a compromised PayRekha host or payout
 * service cannot mint intents.
 */
export class Keyring {
  private readonly keys = new Map<string, { meta: IssuerKey; pub: KeyObject | null }>();
  private gen = 0;

  constructor(keys: readonly IssuerKey[] = []) {
    for (const k of keys) this.add(k);
  }

  /** Bumps on every change; cached verifications from older generations are redone. */
  get generation(): number {
    return this.gen;
  }

  get size(): number {
    return this.keys.size;
  }

  add(key: IssuerKey): void {
    if (key.alg === 'ed25519' && key.publicKey === undefined) throw new TypeError(`key ${key.keyId}: ed25519 needs publicKey`);
    if (key.alg === 'hmac-sha256' && (key.secret === undefined || key.secret.length < 32))
      throw new TypeError(`key ${key.keyId}: hmac-sha256 needs a secret of at least 32 chars`);
    const pub = key.alg === 'ed25519' ? toPublicKey(key.publicKey!) : null;
    this.keys.set(key.keyId, { meta: key, pub });
    this.gen += 1;
  }

  revoke(keyId: string): boolean {
    const k = this.keys.get(keyId);
    if (k === undefined) return false;
    this.keys.set(keyId, { meta: { ...k.meta, revoked: true }, pub: k.pub });
    this.gen += 1;
    return true;
  }

  list(): readonly Omit<IssuerKey, 'secret'>[] {
    return [...this.keys.values()].map(({ meta }) => {
      const { secret: _s, ...rest } = meta;
      void _s;
      return rest;
    });
  }

  verify(intent: Intent, atMs: number): VerifyResult {
    const entry = this.keys.get(intent.keyId);
    if (entry === undefined) return { ok: false, reason: 'unknown-key' };
    const { meta, pub } = entry;
    if (meta.issuer !== intent.issuer) return { ok: false, reason: 'issuer-mismatch' };
    if (!meta.kinds.includes(intent.kind)) return { ok: false, reason: 'kind-not-allowed' };
    if (meta.revoked === true) return { ok: false, reason: 'key-revoked' };
    if (meta.notAfterMs !== undefined && atMs > meta.notAfterMs) return { ok: false, reason: 'key-expired' };
    let sig: Buffer;
    try {
      sig = Buffer.from(intent.signature, 'base64url');
    } catch {
      return { ok: false, reason: 'bad-signature' };
    }
    const payload = intentSigningPayload(intent);
    let good: boolean;
    if (meta.alg === 'ed25519') {
      try {
        good = sig.length === 64 && edVerify(null, payload, pub!, sig);
      } catch {
        good = false;
      }
    } else {
      const expect = createHmac('sha256', meta.secret!).update(payload).digest();
      good = sig.length === expect.length && timingSafeEqual(sig, expect);
    }
    return good ? { ok: true } : { ok: false, reason: 'bad-signature' };
  }
}

const isStr = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isPaise = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/** Shape check for an intent from the wire. Returns a problem string or null. */
export function intentShapeProblem(x: unknown): string | null {
  if (typeof x !== 'object' || x === null) return 'intent must be an object';
  const i = x as Record<string, unknown>;
  if (!isStr(i['intentId'], 128)) return 'intentId must be a non-empty string';
  if (!INTENT_KINDS.includes(i['kind'] as IntentKind)) return 'kind is not a known IntentKind';
  if (!isPaise(i['maxAmountPaise']) || (i['maxAmountPaise'] as number) === 0)
    return 'maxAmountPaise must be a positive integer (paise)';
  if (!isStr(i['beneficiaryRef'])) return 'beneficiaryRef must be a non-empty string';
  if (looksLikeRawIdentifier(i['beneficiaryRef'] as string)) return 'beneficiaryRef looks like a raw identifier; hash it first';
  if (i['subjectRef'] !== undefined && !isStr(i['subjectRef'])) return 'subjectRef must be a string';
  if (!Number.isSafeInteger(i['maxUses']) || (i['maxUses'] as number) < 1) return 'maxUses must be an integer ≥ 1';
  if (!isPaise(i['notBeforeMs']) || !isPaise(i['expiresAtMs'])) return 'notBeforeMs/expiresAtMs must be epoch ms integers';
  if ((i['expiresAtMs'] as number) <= (i['notBeforeMs'] as number)) return 'expiresAtMs must be after notBeforeMs';
  if (!isStr(i['issuer'], 64) || !isStr(i['keyId'], 64)) return 'issuer and keyId are required';
  if (!isStr(i['signature'], 512)) return 'signature is required';
  return null;
}
