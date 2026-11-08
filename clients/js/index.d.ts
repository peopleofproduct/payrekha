// SPDX-License-Identifier: Apache-2.0
// Type definitions for @payrekha/client — mirrors @payrekha/core types.ts.

import type { KeyObject } from 'node:crypto';

export const INTENT_DOMAIN: 'payrekha-intent-v1\n';

export type IntentKind =
  | 'LOAN_DISBURSAL'
  | 'PA_SETTLEMENT'
  | 'REFUND'
  | 'VDA_WITHDRAWAL'
  | 'VENDOR_PAYOUT'
  | 'VERIFICATION';
export const INTENT_KINDS: readonly IntentKind[];

export type Verdict = 'ALLOW' | 'REVIEW' | 'BLOCK';
export type EffectiveAction = 'ALLOW' | 'HOLD' | 'DECLINE';
export type Mode = 'shadow' | 'advise' | 'enforce';
export type AlertState = 'NORMAL' | 'HOLIDAY' | 'HIGH_ALERT';
export type Channel = 'IMPS' | 'NEFT' | 'RTGS' | 'UPI' | 'INTERNAL' | 'CRYPTO';
export type Origin = 'prod' | 'nonprod' | 'unknown';
export type PayoutOutcome = 'settled' | 'failed' | 'reversed';

export interface Intent {
  readonly intentId: string;
  readonly kind: IntentKind;
  readonly maxAmountPaise: number;
  readonly beneficiaryRef: string;
  readonly subjectRef?: string;
  readonly maxUses: number;
  readonly notBeforeMs: number;
  readonly expiresAtMs: number;
  readonly issuer: string;
  readonly keyId: string;
  readonly signature: string;
}
export type UnsignedIntent = Omit<Intent, 'signature'>;

export interface PayoutRequest {
  readonly payoutId: string;
  readonly kind: IntentKind;
  readonly intentId?: string;
  readonly approvalIds?: readonly string[];
  readonly amountPaise: number;
  readonly beneficiaryRef: string;
  readonly beneficiaryMobileRef?: string;
  readonly channel: Channel;
  readonly sourceKeyId: string;
  readonly origin: Origin;
  readonly merchantId?: string;
  readonly clientAttested?: boolean;
  readonly riskScore?: number;
  readonly externalVerdict?: string;
  readonly externalSource?: string;
  readonly sourceHint?: string;
  readonly timestampMs: number;
  readonly clientTimestampMs?: number;
}

export interface RuleHit {
  readonly rule: string;
  readonly verdict: Verdict;
  readonly reason: string;
  readonly evidence: Readonly<Record<string, number | string | boolean>>;
  readonly raiseAlert?: 'HIGH_ALERT';
}
export interface RuleError {
  readonly rule: string;
  readonly message: string;
}
export interface Evaluation {
  readonly verdict: Verdict;
  readonly hits: readonly RuleHit[];
  readonly ruleErrors: readonly RuleError[];
  readonly degraded: boolean;
  readonly elapsedMicros: number;
}
export interface PayoutVerdict extends Evaluation {
  readonly decisionId: string;
  readonly payoutId: string;
  readonly mode: Mode;
  readonly alertState: AlertState;
  readonly effectiveAction: EffectiveAction;
  readonly deduped: boolean;
  readonly riskScore: number;
}

export type BeneficiaryIdentifier =
  | { readonly account: string; readonly ifsc: string }
  | { readonly vpa: string }
  | { readonly mobile: string }
  | { readonly address: string; readonly network: string };

export function canonicalJson(v: unknown): string;
export function normalizeMobile(input: string): string | null;
export function beneficiaryPreimage(id: BeneficiaryIdentifier): string;
export function hashBeneficiary(id: BeneficiaryIdentifier, key: string | Buffer): string;

export interface IssuerKeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
}
export function generateIssuerKeyPair(): IssuerKeyPair;
export function ed25519PrivateKeyFromSeed(seed: Buffer): KeyObject;
export function exportPublicKey(key: KeyObject): string;
export function intentSigningPayload(intent: UnsignedIntent | Intent): Buffer;

export type SignerKey =
  | { readonly alg: 'ed25519'; readonly privateKey: string | KeyObject }
  | { readonly alg: 'hmac-sha256'; readonly secret: string };

export function signIntent(intent: UnsignedIntent, key: SignerKey): Intent;

/** Async signer: receives payload bytes, returns the raw signature. */
export type IntentSignerFn = (payload: Buffer) => Promise<Uint8Array> | Uint8Array;
export function signIntentWith(intent: UnsignedIntent, signer: IntentSignerFn): Promise<Intent>;
export function verifyIntent(intent: Intent, publicKey: string): boolean;

export class PayrekhaError extends Error {
  readonly status: number;
  readonly body: unknown;
}

export interface PayrekhaClientOptions {
  readonly url: string;
  readonly token: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}
export interface CallOptions {
  readonly token?: string;
}

export class PayrekhaClient {
  constructor(opts: PayrekhaClientOptions);
  readonly url: string;
  readonly token: string;
  readonly timeoutMs: number;
  evaluate(payout: PayoutRequest, opts?: CallOptions): Promise<PayoutVerdict>;
  mintIntent(body: Record<string, unknown>, opts?: CallOptions): Promise<Intent & Record<string, unknown>>;
  registerIntent(intent: Intent, opts?: CallOptions): Promise<Record<string, unknown>>;
  getIntent(intentId: string, opts?: CallOptions): Promise<Record<string, unknown>>;
  listIntents(opts?: CallOptions): Promise<Record<string, unknown>>;
  outcome(
    body: { payoutId: string; outcome: PayoutOutcome; sourceKeyId?: string } & Record<string, unknown>,
    opts?: CallOptions,
  ): Promise<Record<string, unknown>>;
  decisions(opts?: CallOptions): Promise<Record<string, unknown>>;
  audit(opts?: CallOptions): Promise<Record<string, unknown>>;
  state(opts?: CallOptions): Promise<Record<string, unknown>>;
  healthz(): Promise<Record<string, unknown>>;
  readyz(): Promise<Record<string, unknown>>;
}
