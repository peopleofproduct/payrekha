// SPDX-License-Identifier: Apache-2.0
// Shared test fixtures: one LOS issuer key, a hash key, a weekday-daytime clock.
import {
  generateIssuerKeyPair,
  hashBeneficiary,
  Payrekha,
  signIntent,
  type FirewallConfig,
  type Intent,
  type IntentKind,
  type IssuerKey,
  type PayoutRequest,
  type UnsignedIntent,
} from '@payrekha/core';
import { payrekhaRules, type RulesConfig } from '@payrekha/rules';

export const HASH_KEY = 'test-hash-key-0123456789abcdef';
export const ADMIN_TOKEN = 'admin-token-for-tests';
export const LOS = generateIssuerKeyPair();
export const RISK = generateIssuerKeyPair();
export const OPS = generateIssuerKeyPair();
export const ALL_KINDS: IntentKind[] = ['LOAN_DISBURSAL', 'PA_SETTLEMENT', 'REFUND', 'VDA_WITHDRAWAL', 'VENDOR_PAYOUT', 'VERIFICATION'];
/** los-prod + risk-desk + ops-team — the multi-approval keyring. */
export const MULTI_KEYS: IssuerKey[] = [
  { keyId: 'los-1', issuer: 'los-prod', alg: 'ed25519', publicKey: LOS.publicKey, kinds: ALL_KINDS },
  { keyId: 'risk-1', issuer: 'risk-desk', alg: 'ed25519', publicKey: RISK.publicKey, kinds: ALL_KINDS },
  { keyId: 'ops-1', issuer: 'ops-team', alg: 'ed25519', publicKey: OPS.publicKey, kinds: ALL_KINDS },
];
/** Wed 4 Nov 2026, 11:00 IST — not a weekend, not night. */
export const T0 = Date.UTC(2026, 10, 4, 5, 30);
export const MIN = 60_000;

export const ref = (vpa: string): string => hashBeneficiary({ vpa }, HASH_KEY);

import { createHash } from 'node:crypto';
export const adminSha = createHash('sha256').update(ADMIN_TOKEN).digest('hex');
export const admin = { actor: 'test', reason: 'test', adminToken: ADMIN_TOKEN };

export function firewall(
  config: FirewallConfig = {},
  rules: RulesConfig = {},
  keys?: IssuerKey[],
): { fw: Payrekha; feed: ReturnType<typeof payrekhaRules>['feed'] } {
  const set = payrekhaRules({ band: false, ...rules });
  const fw = new Payrekha(set.rules, {
    config: { mode: 'enforce', adminTokenSha256: adminSha, ...config },
    keys: keys ?? [{ keyId: 'los-1', issuer: 'los-prod', alg: 'ed25519', publicKey: LOS.publicKey, kinds: ALL_KINDS }],
    now: () => T0,
  });
  return { fw, feed: set.feed };
}

let n = 0;
export function intent(fw: Payrekha, o: Partial<UnsignedIntent> & { beneficiaryRef: string }, privateKey: string = LOS.privateKey): Intent {
  n += 1;
  const u: UnsignedIntent = {
    intentId: `int-${n}`,
    kind: 'LOAN_DISBURSAL',
    maxAmountPaise: 5_00_000_00,
    maxUses: 1,
    notBeforeMs: T0 - 60 * MIN,
    expiresAtMs: T0 + 24 * 60 * MIN,
    issuer: 'los-prod',
    keyId: 'los-1',
    ...o,
  };
  const i = signIntent(u, { alg: 'ed25519', privateKey });
  const r = fw.registerIntent(i, T0);
  if (!r.accepted) throw new Error(`fixture intent rejected: ${r.reason}`);
  return i;
}

let p = 0;
export function payout(o: Partial<PayoutRequest> & { beneficiaryRef: string }): PayoutRequest {
  p += 1;
  return {
    payoutId: `po-${p}`,
    kind: 'LOAN_DISBURSAL',
    amountPaise: 1_00_000_00,
    channel: 'IMPS',
    sourceKeyId: 'lms-prod',
    origin: 'prod',
    timestampMs: T0,
    ...o,
  };
}

export const ruleIds = (v: { hits: readonly { rule: string }[] }): string[] => v.hits.map((h) => h.rule);
