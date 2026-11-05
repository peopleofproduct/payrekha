// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { createHmac } from 'node:crypto';

/** Raw beneficiary identifiers. These are hashed on entry and never stored. */
export type BeneficiaryIdentifier =
  | { readonly account: string; readonly ifsc: string }
  | { readonly vpa: string }
  | { readonly mobile: string }
  | { readonly address: string; readonly network: string };

const MOBILE = /^(?:\+?91|0)?([6-9]\d{9})$/;

/** 10-digit Indian mobile, or null. Same rule as Krediwall's dpi-adapters. */
export function normalizeMobile(input: string): string | null {
  const m = MOBILE.exec(input.replace(/[\s\-()]/g, ''));
  return m?.[1] ?? null;
}

/** Canonical pre-image for each identifier type, namespaced so types never collide. */
export function beneficiaryPreimage(id: BeneficiaryIdentifier): string {
  if ('account' in id) {
    const account = id.account.replace(/[\s-]/g, '');
    const ifsc = id.ifsc.trim().toUpperCase();
    if (!/^\d{6,20}$/.test(account)) throw new TypeError('account number must be 6–20 digits');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new TypeError('IFSC must look like ABCD0123456');
    return `acct:${account}|${ifsc}`;
  }
  if ('vpa' in id) {
    const vpa = id.vpa.trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/.test(vpa)) throw new TypeError('VPA must look like name@handle');
    return `vpa:${vpa}`;
  }
  if ('mobile' in id) {
    const mobile = normalizeMobile(id.mobile);
    if (mobile === null) throw new TypeError('mobile must be a 10-digit Indian number');
    return `mob:${mobile}`;
  }
  return `vda:${id.network.trim().toLowerCase()}:${id.address.trim()}`;
}

/**
 * Keyed HMAC-SHA256 of a beneficiary identifier, base64url, prefixed `hb1_`.
 * The key is operator-supplied and must be the same everywhere a ref is
 * produced (LOS signing intents, payout service, gateway). Without the key
 * a ref cannot be dictionary-reversed — unlike a plain hash of a 10-digit
 * mobile number. (DPDP Act: data minimisation.)
 */
export function hashBeneficiary(id: BeneficiaryIdentifier, key: string | Buffer): string {
  if (key.length < 16) throw new RangeError('beneficiary HMAC key must be at least 16 bytes');
  return `hb1_${createHmac('sha256', key).update(beneficiaryPreimage(id)).digest('base64url')}`;
}

const RAW_ACCOUNT = /^\d{6,20}$/;
const RAW_IFSC = /[A-Z]{4}0[A-Z0-9]{6}/i;

/**
 * True when a "ref" looks like a raw identifier — a VPA, a phone or account
 * number, an IFSC. The firewall refuses to evaluate (or store) such refs:
 * degraded REVIEW, and the value never reaches the decision log.
 */
export function looksLikeRawIdentifier(ref: string): boolean {
  if (ref.includes('@')) return true;
  const compact = ref.replace(/[\s\-+]/g, '');
  if (RAW_ACCOUNT.test(compact)) return true;
  if (RAW_IFSC.test(ref) && /\d{6,}/.test(ref)) return true;
  return false;
}
