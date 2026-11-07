// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

/** Severity-ordered verdicts. Same vocabulary as Krediwall. */
export const Verdict = {
  Allow: 'ALLOW',
  Review: 'REVIEW',
  Block: 'BLOCK',
} as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

/** What actually happened to the payout once the mode is applied. */
export type EffectiveAction = 'ALLOW' | 'HOLD' | 'DECLINE';

/**
 * `shadow` logs only (default). `advise` returns the verdict and the caller
 * decides. `enforce` holds REVIEW and declines BLOCK.
 */
export type Mode = 'shadow' | 'advise' | 'enforce';

/** `HIGH_ALERT` never auto-expires — it needs an authenticated reset. */
export type AlertState = 'NORMAL' | 'HOLIDAY' | 'HIGH_ALERT';

export type IntentKind =
  | 'LOAN_DISBURSAL'
  | 'PA_SETTLEMENT'
  | 'REFUND'
  | 'VDA_WITHDRAWAL'
  | 'VENDOR_PAYOUT'
  /** Penny-drop / account verification. */
  | 'VERIFICATION';

export const INTENT_KINDS: readonly IntentKind[] = [
  'LOAN_DISBURSAL',
  'PA_SETTLEMENT',
  'REFUND',
  'VDA_WITHDRAWAL',
  'VENDOR_PAYOUT',
  'VERIFICATION',
];

export type Channel = 'IMPS' | 'NEFT' | 'RTGS' | 'UPI' | 'INTERNAL' | 'CRYPTO';
export const CHANNELS: readonly Channel[] = ['IMPS', 'NEFT', 'RTGS', 'UPI', 'INTERNAL', 'CRYPTO'];

export type Origin = 'prod' | 'nonprod' | 'unknown';

/**
 * "Why this money is allowed to leave." Created and signed by the system of
 * record (LOS/LMS, settlement engine, withdrawal service) — never by the
 * service that calls the payout API.
 */
export interface Intent {
  readonly intentId: string;
  readonly kind: IntentKind;
  /** Upper bound in paise; the payout (or the sum of uses) may be ≤. */
  readonly maxAmountPaise: number;
  /** Keyed HMAC of account|IFSC or VPA. Never the raw identifier. */
  readonly beneficiaryRef: string;
  /** Loan / application / merchant id, hashed or opaque. */
  readonly subjectRef?: string;
  /** Default 1 (single-use). */
  readonly maxUses: number;
  readonly notBeforeMs: number;
  readonly expiresAtMs: number;
  /** e.g. "los-prod". */
  readonly issuer: string;
  /** Which issuer key signed it. */
  readonly keyId: string;
  /** base64url signature over the canonical payload (every field but this one). */
  readonly signature: string;
}

/** A request to move money, as seen at the payout API. */
export interface PayoutRequest {
  readonly payoutId: string;
  readonly kind: IntentKind;
  readonly intentId?: string;
  readonly amountPaise: number;
  /** Hashed beneficiary reference (see `hashBeneficiary`). */
  readonly beneficiaryRef: string;
  /** Hashed mobile, for fraud-feed lookups. */
  readonly beneficiaryMobileRef?: string;
  readonly channel: Channel;
  /** Which API key / client called the payout API. */
  readonly sourceKeyId: string;
  /** Set by the gateway / network layer — never trusted from the caller. */
  readonly origin: Origin;
  /** PA settlements. */
  readonly merchantId?: string;
  /** Result of app attestation, if the operator has it. */
  readonly clientAttested?: boolean;
  /**
   * Upstream risk signal (0..1) from a fraud vendor or the caller's own
   * scorer — advisory only: it can make a verdict stricter, never looser.
   * A caller minimizing its own score only evades an advisory input; the
   * intent binding and behaviour rules are unaffected.
   */
  readonly riskScore?: number;
  /** Upstream verdict word ('block'|'decline'|'review'|'challenge'|…) — advisory, same deal as riskScore. */
  readonly externalVerdict?: string;
  /** Who produced the signal ('feedzai', 'sardine', 'los-heuristic') — evidence label. */
  readonly externalSource?: string;
  /**
   * Edge-asserted source-network hint for this call — the socket peer IP
   * on /v1/evaluate, or proxy-asserted header parts (IP, user-agent, geo)
   * joined `|` on ext_authz. Untrusted evidence: stamped by the
   * gateway/edge layer, never honoured from the request body. Advisory
   * like `riskScore` — feeds `identity.fingerprint` and the decision log.
   */
  readonly sourceHint?: string;
  readonly timestampMs: number;
  /**
   * Untrusted evidence, not an input: when the gateway overrides a
   * caller-supplied `timestampMs` with server time, the caller's value is
   * kept here so timestamp games show up in the decision log.
   */
  readonly clientTimestampMs?: number;
}

/** One positive rule firing. */
export interface RuleHit {
  readonly rule: string;
  readonly verdict: Verdict;
  readonly reason: string;
  /** The numbers behind `reason`. Flat, JSON-safe, never raw PII. */
  readonly evidence: Readonly<Record<string, number | string | boolean>>;
  /** A rule may ask the firewall to raise the alert state (canary trips). */
  readonly raiseAlert?: 'HIGH_ALERT';
}

/** A rule that threw. Recorded, never re-thrown. */
export interface RuleError {
  readonly rule: string;
  readonly message: string;
}

/** Generic engine result (no payout semantics). */
export interface Evaluation {
  readonly verdict: Verdict;
  readonly hits: readonly RuleHit[];
  readonly ruleErrors: readonly RuleError[];
  /** Malformed input or a rule threw: coverage was not complete. */
  readonly degraded: boolean;
  readonly elapsedMicros: number;
}

/** Final PayRekha decision for one payout. */
export interface PayoutVerdict extends Evaluation {
  readonly decisionId: string;
  readonly payoutId: string;
  readonly mode: Mode;
  readonly alertState: AlertState;
  /** What actually happened given `mode`. In shadow, BLOCK still ALLOWs. */
  readonly effectiveAction: EffectiveAction;
  /** True when this verdict is a retry served from the dedupe window. */
  readonly deduped: boolean;
  /**
   * Deterministic risk score 0..1 derived from the strongest rule hit
   * (BLOCK severity → 1.0) with a small degraded-coverage bump — for
   * analyst sorting/triage, not an ML confidence.
   */
  readonly riskScore: number;
}

/** Terminal payout status reported back by the payout service. */
export type PayoutOutcome = 'settled' | 'failed' | 'reversed';

/** A state-changing operator action. Every one is audited. */
export interface AuditEntry {
  readonly atMs: number;
  readonly action: string;
  readonly actor: string;
  readonly reason: string;
  readonly from?: string;
  readonly to?: string;
}
