// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { hashBeneficiary, type BeneficiaryIdentifier } from '@payrekha/core';

/**
 * Declarative field mapping for the Envoy ext_authz adapter. Each value is
 * a dot-path into the forwarded request (`body.x.y`, `header.x-name`,
 * `query.k`, `path`) or `{ "const": value }`. Raw beneficiary fields named
 * under `beneficiary` are hashed on entry and never stored.
 */
export type Source = string | { readonly const: string | number | boolean };

export interface FieldMapping {
  readonly payoutId: Source;
  readonly kind: Source;
  readonly amountPaise: Source;
  readonly intentId?: Source;
  readonly beneficiaryRef?: Source;
  readonly beneficiary?: { readonly account?: Source; readonly ifsc?: Source; readonly vpa?: Source; readonly mobile?: Source };
  readonly beneficiaryMobile?: Source;
  readonly channel?: Source;
  readonly sourceKeyId?: Source;
  readonly merchantId?: Source;
  readonly clientAttested?: Source;
  readonly timestampMs?: Source;
}

export interface ForwardedRequest {
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export function readPath(req: ForwardedRequest, path: string): unknown {
  const [root, ...rest] = path.split('.');
  if (root === 'path') return req.path;
  if (root === 'header') {
    const v = req.headers[rest.join('.').toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  }
  if (root === 'query') return req.query[rest.join('.')];
  if (root !== 'body') return undefined;
  let cur: unknown = req.body;
  for (const k of rest) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const resolve = (req: ForwardedRequest, s: Source | undefined): unknown =>
  s === undefined ? undefined : typeof s === 'string' ? readPath(req, s) : s.const;

const asInt = (v: unknown): unknown => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
const asBool = (v: unknown): unknown => (v === 'true' ? true : v === 'false' ? false : v);

/**
 * Build a PayoutRequest-shaped object. Anything missing or malformed is
 * left for the firewall's shape check to turn into a degraded REVIEW —
 * the adapter never guesses.
 */
export function mapPayout(req: ForwardedRequest, m: FieldMapping, hashKey: string | undefined, fixed: { origin: string; sourceKeyId?: string; nowMs: number }): Record<string, unknown> {
  const out: Record<string, unknown> = {
    payoutId: resolve(req, m.payoutId),
    kind: resolve(req, m.kind),
    amountPaise: asInt(resolve(req, m.amountPaise)),
    channel: resolve(req, m.channel) ?? 'IMPS',
    sourceKeyId: fixed.sourceKeyId ?? resolve(req, m.sourceKeyId) ?? 'ext_authz',
    origin: fixed.origin,
    timestampMs: asInt(resolve(req, m.timestampMs)) ?? fixed.nowMs,
  };
  const opt = { intentId: m.intentId, merchantId: m.merchantId };
  for (const [k, s] of Object.entries(opt)) {
    const v = resolve(req, s);
    if (v !== undefined && v !== '') out[k] = v;
  }
  const att = asBool(resolve(req, m.clientAttested));
  if (att !== undefined) out['clientAttested'] = att;
  const ref = resolve(req, m.beneficiaryRef);
  if (typeof ref === 'string') out['beneficiaryRef'] = ref;
  else if (m.beneficiary !== undefined && hashKey !== undefined) out['beneficiaryRef'] = hashRaw(req, m.beneficiary, hashKey);
  const mob = resolve(req, m.beneficiaryMobile);
  if (typeof mob === 'string' && hashKey !== undefined) {
    try {
      out['beneficiaryMobileRef'] = hashBeneficiary({ mobile: mob }, hashKey);
    } catch {
      /* unusable mobile: feed lookup simply skipped */
    }
  }
  return out;
}

function hashRaw(req: ForwardedRequest, b: NonNullable<FieldMapping['beneficiary']>, key: string): string | undefined {
  const s = (x: Source | undefined) => {
    const v = resolve(req, x);
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
  };
  const account = s(b.account);
  const ifsc = s(b.ifsc);
  const vpa = s(b.vpa);
  const mobile = s(b.mobile);
  const id: BeneficiaryIdentifier | undefined =
    account !== undefined && ifsc !== undefined ? { account, ifsc } : vpa !== undefined ? { vpa } : mobile !== undefined ? { mobile } : undefined;
  if (id === undefined) return undefined;
  try {
    return hashBeneficiary(id, key);
  } catch {
    return undefined;
  }
}
