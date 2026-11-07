// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { createHash, timingSafeEqual } from 'node:crypto';
import { Calendar, type CalendarConfig, type CalendarWindow } from './calendar.js';
import { Engine, severity, type EngineMetrics, type Rule } from './engine.js';
import { looksLikeRawIdentifier } from './hash.js';
import { intentSigningPayload, signIntent, Keyring, type IssuerKey, type SignerKey, type UnsignedIntent } from './intent.js';
import { BeneficiaryLedger, CanaryRegistry, MerchantLedger, type BeneficiaryEntry, type CanarySets, type MerchantEntry } from './ledger.js';
import { IntentRegistry, MemoryIntentStore, type IntentCheck, type IntentStore, type RegisterResult } from './registry.js';
import type { SharedControlState } from './shared.js';
import {
  CHANNELS,
  INTENT_KINDS,
  Verdict,
  type AlertState,
  type ApprovalRequirement,
  type AuditEntry,
  type EffectiveAction,
  type IntentKind,
  type Mode,
  type PayoutOutcome,
  type PayoutRequest,
  type PayoutVerdict,
} from './types.js';

/** Parameters for a managed (gateway-minted) intent — see `mintIntent`. */
export interface MintSpec {
  /** Signing keyId registered in the keyring; issuer/kinds come from its meta. */
  readonly keyId: string;
  /** The signing key itself — held by the gateway in the managed tier only. */
  readonly key: SignerKey;
  /** Idempotency id; when omitted it is derived from the signed fields. */
  readonly intentId?: string;
  readonly kind: IntentKind;
  readonly maxAmountPaise: number;
  /** Hashed beneficiary reference (hashBeneficiary output) — raw ids are rejected by the shape check. */
  readonly beneficiaryRef: string;
  readonly subjectRef?: string;
  readonly maxUses?: number;
  readonly notBeforeMs?: number;
  readonly ttlMs?: number;
  readonly expiresAtMs?: number;
}

export type MintResult = RegisterResult & { readonly intentId?: string };

/** Threshold multipliers applied by rules for the current alert state. ≤ 1 tightens. */
export interface Multipliers {
  /** Scales velocity count/sum budgets. */
  readonly velocity: number;
  /** Scales the cooling-period amount threshold. */
  readonly coolingAmount: number;
}

export interface FirewallConfig {
  /** Default `shadow`: observe and log, never block, until an operator opts in. */
  readonly mode?: Mode;
  readonly modeByKind?: Partial<Record<IntentKind, Mode>>;
  /** Kinds that need an intent. Default: every kind. HIGH_ALERT forces every kind regardless. */
  readonly requireIntent?: Partial<Record<IntentKind, boolean>>;
  /**
   * Kinds needing m-of-n approval (ADR 0003): the payout must cite `count`
   * intents — `intentId` plus `approvalIds` — each signed by a *distinct*
   * issuer. A bare number means `{ count }` with BLOCK on insufficiency;
   * `{ count, onInsufficient: 'review' }` holds instead of declining — the
   * safeguard is on while approver systems onboard. `approverIssuers`
   * restricts which issuers count (the risk desk's keyring).
   */
  readonly requiredApprovals?: Partial<Record<IntentKind, number | ApprovalRequirement>>;
  readonly multipliers?: Partial<Record<AlertState, Partial<Multipliers>>>;
  /** Enter HIGH_ALERT after this many BLOCK verdicts within `windowMs`. `count: 0` disables. */
  readonly highAlertOnBlocks?: { readonly count: number; readonly windowMs: number };
  readonly calendar?: CalendarConfig;
  /** Micro-value threshold (paise) for the ledger's probe memory. Default ₹10. */
  readonly microPaise?: number;
  /** Retry dedupe window (payoutIds). Default 10,000. */
  readonly dedupeCapacity?: number;
  readonly ledgerCapacity?: number;
  /**
   * Max |firewall clock − payout.timestampMs|. Outside the bound the payout
   * is evaluated at firewall time and the verdict is marked degraded with a
   * `time.skew` hit. Unset = caller timestamps are trusted (replay needs
   * that). Set it whenever the caller is untrusted.
   */
  readonly maxTimestampSkewMs?: number;
  /** SHA-256 hex of the admin token. Lowering HIGH_ALERT or the mode needs it. */
  readonly adminTokenSha256?: string;
}

export const DEFAULT_MULTIPLIERS: Readonly<Record<AlertState, Multipliers>> = {
  NORMAL: { velocity: 1, coolingAmount: 1 },
  HOLIDAY: { velocity: 0.5, coolingAmount: 0.5 },
  HIGH_ALERT: { velocity: 0.25, coolingAmount: 0.25 },
};

/** Everything a payout rule can read. Built once per evaluation. */
export interface PayoutContext {
  readonly nowMs: number;
  readonly alertState: AlertState;
  readonly multipliers: Multipliers;
  readonly calendarWindow: CalendarWindow | null;
  readonly intent: IntentCheck;
  /** Ledger entry *before* this payout (undefined = never seen). */
  readonly beneficiary: BeneficiaryEntry | undefined;
  readonly merchant: MerchantEntry | undefined;
  readonly canaries: CanarySets;
  readonly microPaise: number;
}

export type PayoutRule = Rule<PayoutRequest, PayoutContext>;

export interface Credential {
  readonly actor: string;
  readonly reason: string;
  readonly adminToken?: string;
}

export interface FirewallOptions {
  readonly config?: FirewallConfig;
  readonly keys?: readonly IssuerKey[];
  readonly keyring?: Keyring;
  readonly intentStore?: IntentStore;
  /** Called once per fresh decision. Hand it to your own writer; it must not block. */
  readonly onDecision?: (v: PayoutVerdict, p: PayoutRequest) => void;
  readonly onAudit?: (e: AuditEntry) => void;
  readonly onAlertChange?: (from: AlertState, to: AlertState, e: AuditEntry) => void;
  readonly onRuleError?: (rule: string, error: unknown) => void;
  /** Clock for audit entries and the `maxTimestampSkewMs` bound. Verdicts otherwise use `payout.timestampMs`. */
  readonly now?: () => number;
}

export interface FirewallSnapshot {
  readonly version: 1;
  readonly exportedAtMs: number;
  readonly highAlert: { readonly since: number; readonly reason: string } | null;
  readonly mode: Mode;
  readonly modeByKind: Partial<Record<IntentKind, Mode>>;
  readonly intents: unknown;
  readonly beneficiaries: unknown;
  readonly merchants: unknown;
  readonly canaries: unknown;
  readonly rules: Readonly<Record<string, unknown>>;
  readonly audit: readonly AuditEntry[];
  /** keyIds revoked at runtime — they must stay revoked across restarts. */
  readonly issuers?: { readonly revoked?: readonly string[] };
  /**
   * In-window BLOCK timestamps behind `highAlertOnBlocks`. Bounded by the
   * burst count; without it a restart mid-burst would silently reset the
   * counter and let the pattern evade HIGH_ALERT.
   */
  readonly recentBlocks?: readonly number[];
}

const isStr = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Shape check. Messages name the field, never echo its value (no PII in errors). */
const MODES: readonly Mode[] = ['shadow', 'advise', 'enforce'];
const posInt = (v: number | undefined, name: string, min = 1): void => {
  if (v !== undefined && (!Number.isSafeInteger(v) || v < min)) throw new TypeError(`firewall config ${name} must be an integer ≥ ${min}`);
};

/**
 * Fail loud on config that would silently change security posture: a typo'd
 * kind in `modeByKind`/`requireIntent` or a non-finite multiplier means the
 * operator believes a control is on when it is not. Called at construction —
 * boot dies before a bad config can serve.
 */
export function validateFirewallConfig(cfg: FirewallConfig): void {
  if (cfg.mode !== undefined && !MODES.includes(cfg.mode)) throw new TypeError(`firewall config mode must be shadow, advise or enforce (got ${String(cfg.mode)})`);
  for (const [table, name] of [[cfg.modeByKind, 'modeByKind'], [cfg.requireIntent, 'requireIntent'], [cfg.requiredApprovals, 'requiredApprovals']] as const) {
    for (const k of Object.keys(table ?? {})) {
      if (!INTENT_KINDS.includes(k as IntentKind)) throw new TypeError(`firewall config ${name}.${k}: not a known IntentKind — a typo silently disables the rule`);
    }
  }
  for (const [k, v] of Object.entries(cfg.requiredApprovals ?? {})) {
    const r = typeof v === 'number' ? { count: v } : v;
    if (!Number.isSafeInteger(r?.count) || (r?.count ?? 0) < 2) throw new TypeError(`firewall config requiredApprovals.${k} must be an integer ≥ 2 (1 is the primary alone — leave the kind unset)`);
    if (r?.onInsufficient !== undefined && r.onInsufficient !== 'block' && r.onInsufficient !== 'review') throw new TypeError(`firewall config requiredApprovals.${k}.onInsufficient must be block|review`);
    if (r?.approverIssuers !== undefined && (!Array.isArray(r.approverIssuers) || !r.approverIssuers.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 64))) throw new TypeError(`firewall config requiredApprovals.${k}.approverIssuers must be non-empty strings`);
  }
  for (const v of Object.values(cfg.modeByKind ?? {})) {
    if (!MODES.includes(v as Mode)) throw new TypeError(`firewall config modeByKind value must be shadow, advise or enforce (got ${String(v)})`);
  }
  for (const [state, m] of Object.entries(cfg.multipliers ?? {})) {
    if (!(state in DEFAULT_MULTIPLIERS)) throw new TypeError(`firewall config multipliers.${state}: not a known alert state`);
    for (const [k, v] of Object.entries(m ?? {})) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new TypeError(`firewall config multipliers.${state}.${k} must be a positive finite number`);
    }
  }
  if (cfg.highAlertOnBlocks !== undefined) {
    posInt(cfg.highAlertOnBlocks.count, 'highAlertOnBlocks.count', 0);
    posInt(cfg.highAlertOnBlocks.windowMs, 'highAlertOnBlocks.windowMs');
  }
  posInt(cfg.microPaise, 'microPaise');
  posInt(cfg.dedupeCapacity, 'dedupeCapacity');
  posInt(cfg.ledgerCapacity, 'ledgerCapacity');
  posInt(cfg.maxTimestampSkewMs, 'maxTimestampSkewMs');
  if (cfg.adminTokenSha256 !== undefined && !/^[0-9a-f]{64}$/i.test(cfg.adminTokenSha256)) throw new TypeError('firewall config adminTokenSha256 must be a SHA-256 hex string');
}

export function payoutShapeProblem(x: unknown): string | null {
  if (typeof x !== 'object' || x === null) return 'payout must be an object';
  const p = x as Record<string, unknown>;
  if (!isStr(p['payoutId'], 128)) return 'payoutId';
  if (!INTENT_KINDS.includes(p['kind'] as IntentKind)) return 'kind';
  if (p['intentId'] !== undefined && typeof p['intentId'] !== 'string') return 'intentId';
  if (p['approvalIds'] !== undefined && (!Array.isArray(p['approvalIds']) || (p['approvalIds'] as unknown[]).length > 8 || !(p['approvalIds'] as unknown[]).every((a) => isStr(a, 128)))) return 'approvalIds (array of ≤8 intent ids)';
  if (!Number.isSafeInteger(p['amountPaise']) || (p['amountPaise'] as number) <= 0) return 'amountPaise (positive integer paise)';
  if (!isStr(p['beneficiaryRef'])) return 'beneficiaryRef';
  if (looksLikeRawIdentifier(p['beneficiaryRef'] as string)) return 'beneficiaryRef looks raw (hash it)';
  if (p['beneficiaryMobileRef'] !== undefined && (!isStr(p['beneficiaryMobileRef']) || looksLikeRawIdentifier(p['beneficiaryMobileRef'] as string)))
    return 'beneficiaryMobileRef';
  if (!CHANNELS.includes(p['channel'] as never)) return 'channel';
  if (!isStr(p['sourceKeyId'], 128)) return 'sourceKeyId';
  if (p['origin'] !== 'prod' && p['origin'] !== 'nonprod' && p['origin'] !== 'unknown') return 'origin';
  if (p['merchantId'] !== undefined && !isStr(p['merchantId'], 128)) return 'merchantId';
  if (p['clientAttested'] !== undefined && typeof p['clientAttested'] !== 'boolean') return 'clientAttested';
  if (p['riskScore'] !== undefined && (typeof p['riskScore'] !== 'number' || !Number.isFinite(p['riskScore']) || p['riskScore'] < 0 || p['riskScore'] > 1)) return 'riskScore (number 0..1)';
  if (p['externalVerdict'] !== undefined && !isStr(p['externalVerdict'], 64)) return 'externalVerdict';
  if (p['externalSource'] !== undefined && !isStr(p['externalSource'], 64)) return 'externalSource';
  if (p['sourceHint'] !== undefined && !isStr(p['sourceHint'], 256)) return 'sourceHint';
  if (!Number.isSafeInteger(p['timestampMs']) || (p['timestampMs'] as number) <= 0) return 'timestampMs';
  return null;
}

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();

/** `requiredApprovals` accepts `2` as sugar for `{ count: 2 }`. */
const approvalRequirement = (table: FirewallConfig['requiredApprovals'], kind: IntentKind | undefined): ApprovalRequirement | undefined => {
  const v = kind !== undefined ? table?.[kind] : undefined;
  return typeof v === 'number' ? { count: v } : v;
};

/**
 * The payout firewall: binds each payout to a signed intent, runs the
 * ordered rule set, applies mode and alert state, and remembers just
 * enough (hashed refs only) to catch probes, cooling breaches and bursts.
 */
export class Payrekha {
  readonly keyring: Keyring;
  readonly intents: IntentRegistry;
  readonly beneficiaries: BeneficiaryLedger;
  readonly merchants = new MerchantLedger();
  readonly canaries = new CanaryRegistry();
  readonly calendar: Calendar;
  private readonly engine: Engine<PayoutRequest, PayoutContext>;
  private readonly cfg: FirewallConfig;
  private readonly opts: FirewallOptions;
  private readonly multipliers: Record<AlertState, Multipliers>;
  private mode: Mode;
  private modeByKind: Partial<Record<IntentKind, Mode>>;
  private highAlert: { since: number; reason: string } | null = null;
  private readonly recentBlocks: number[] = [];
  private readonly dedupe = new Map<string, PayoutVerdict>();
  private readonly dedupeCap: number;
  private readonly audit: AuditEntry[] = [];
  private seq = 0;
  private dedupedCount = 0;
  private hookErrors = 0;
  private readonly effective = { ALLOW: 0, HOLD: 0, DECLINE: 0 };

  constructor(rules: readonly PayoutRule[], options: FirewallOptions = {}) {
    this.opts = options;
    this.cfg = options.config ?? {};
    validateFirewallConfig(this.cfg);
    this.keyring = options.keyring ?? new Keyring(options.keys ?? []);
    this.intents = new IntentRegistry(this.keyring, options.intentStore ?? new MemoryIntentStore());
    this.beneficiaries = new BeneficiaryLedger(this.cfg.ledgerCapacity);
    this.calendar = new Calendar(this.cfg.calendar);
    this.mode = this.cfg.mode ?? 'shadow';
    this.modeByKind = { ...(this.cfg.modeByKind ?? {}) };
    this.dedupeCap = this.cfg.dedupeCapacity ?? 10_000;
    const m = this.cfg.multipliers ?? {};
    this.multipliers = {
      NORMAL: { ...DEFAULT_MULTIPLIERS.NORMAL, ...m.NORMAL },
      HOLIDAY: { ...DEFAULT_MULTIPLIERS.HOLIDAY, ...m.HOLIDAY },
      HIGH_ALERT: { ...DEFAULT_MULTIPLIERS.HIGH_ALERT, ...m.HIGH_ALERT },
    };
    this.engine = new Engine(rules, {
      validate: payoutShapeProblem,
      ...(options.onRuleError !== undefined ? { onRuleError: options.onRuleError } : {}),
    });
  }

  // ---------------------------------------------------------------- verdicts

  evaluate(payout: PayoutRequest): PayoutVerdict {
    // Dedupe is scoped to the caller: one key must not preload another key's
    // payout ids with verdicts it chose.
    const dedupeKey = typeof payout?.payoutId === 'string' ? `${String(payout?.sourceKeyId ?? '')}\n${payout.payoutId}` : undefined;
    const cached = dedupeKey !== undefined ? this.dedupe.get(dedupeKey) : undefined;
    if (cached !== undefined) {
      this.dedupedCount += 1;
      // The rule outcome is idempotent; the effective action is not — it
      // follows the mode in force NOW, so a shadow→enforce flip must not
      // keep serving ALLOW for a verdict that is really a BLOCK.
      const mode = (payout?.kind !== undefined ? this.modeByKind[payout.kind] : undefined) ?? this.mode;
      const effectiveAction: EffectiveAction =
        mode === 'shadow' ? 'ALLOW' : cached.verdict === Verdict.Block ? 'DECLINE' : cached.verdict === Verdict.Review ? 'HOLD' : 'ALLOW';
      this.effective[effectiveAction] += 1;
      return { ...cached, mode, effectiveAction, deduped: true };
    }
    const ts = Number.isSafeInteger(payout?.timestampMs) ? payout.timestampMs : 0;
    const nowMs = this.now();
    // A caller-controlled clock must not move intent windows, velocity budgets
    // or the block-burst counter. The claim is `clientTimestampMs` when a
    // stamping gateway kept it, else `timestampMs` itself. Outside the bound,
    // evaluate at firewall time and mark the verdict degraded — the skew
    // itself is evidence.
    const clientTs = payout?.clientTimestampMs;
    const claimMs = typeof clientTs === 'number' && Number.isSafeInteger(clientTs) ? clientTs : ts;
    const skewMs = this.cfg.maxTimestampSkewMs;
    const skewed = skewMs !== undefined && claimMs > 0 && Math.abs(nowMs - claimMs) > skewMs;
    const evalPayout = skewed ? { ...payout, timestampMs: nowMs } : payout;
    const evalTs = skewed ? nowMs : ts;
    const calendarWindow = evalTs > 0 ? this.calendar.window(evalTs) : null;
    const alertState: AlertState = this.highAlert !== null ? 'HIGH_ALERT' : calendarWindow !== null ? 'HOLIDAY' : 'NORMAL';
    const wellFormed = payoutShapeProblem(evalPayout) === null;
    const required = alertState === 'HIGH_ALERT' || (wellFormed && this.cfg.requireIntent?.[evalPayout.kind] !== false);
    const ctx: PayoutContext = {
      nowMs: evalTs,
      alertState,
      multipliers: this.multipliers[alertState],
      calendarWindow,
      intent: wellFormed ? this.intents.check(evalPayout, required, approvalRequirement(this.cfg.requiredApprovals, evalPayout.kind)) : { status: 'missing', required },
      beneficiary: wellFormed ? this.beneficiaries.get(evalPayout.beneficiaryRef) : undefined,
      merchant: wellFormed && evalPayout.merchantId !== undefined ? this.merchants.get(evalPayout.merchantId) : undefined,
      canaries: this.canaries,
      microPaise: this.cfg.microPaise ?? 1_000,
    };
    let ev = this.engine.evaluate(evalPayout, ctx);
    if (skewed && skewMs !== undefined) {
      const offsetMs = Math.abs(nowMs - claimMs);
      ev = {
        ...ev,
        hits: [
          ...ev.hits,
          {
            rule: 'time.skew',
            verdict: Verdict.Review,
            reason: `Payout's claimed timestamp is ${Math.round(offsetMs / 60_000)} min off firewall time (allowed ±${Math.round(skewMs / 60_000)} min); evaluated at firewall time`,
            evidence: { offsetMs, boundMs: skewMs, clientTimestampMs: claimMs },
          },
        ],
        verdict: severity(ev.verdict) >= severity(Verdict.Review) ? ev.verdict : Verdict.Review,
        degraded: true,
      };
    }
    const kind = wellFormed ? evalPayout.kind : undefined;
    const mode = (kind !== undefined ? this.modeByKind[kind] : undefined) ?? this.mode;
    const effectiveAction: EffectiveAction =
      mode === 'shadow' ? 'ALLOW' : ev.verdict === Verdict.Block ? 'DECLINE' : ev.verdict === Verdict.Review ? 'HOLD' : 'ALLOW';
    this.effective[effectiveAction] += 1;

    for (const h of ev.hits) {
      if (h.raiseAlert === 'HIGH_ALERT') this.enterHighAlert(`rule:${h.rule}`, h.reason, evalTs);
    }
    if (ev.verdict === Verdict.Block) this.countBlock(evalTs);

    if (wellFormed) this.remember(evalPayout, ctx, effectiveAction);

    this.seq += 1;
    const decisionId = `pd_${createHash('sha256').update(`${String(payout?.payoutId)}|${evalTs}|${this.seq}`).digest('base64url').slice(0, 22)}`;
    const verdict: PayoutVerdict = {
      ...ev,
      decisionId,
      payoutId: String(payout?.payoutId ?? ''),
      mode,
      alertState,
      effectiveAction,
      deduped: false,
      // Analyst-facing score: strongest hit normalized (BLOCK→1.0, REVIEW→0.5),
      // +0.1 when coverage was incomplete. Deterministic — not an ML confidence.
      riskScore: Math.min(1, ev.hits.reduce((m, h) => Math.max(m, severity(h.verdict) / 2), 0) + (ev.degraded ? 0.1 : 0)),
    };
    if (dedupeKey !== undefined) {
      this.dedupe.set(dedupeKey, verdict);
      if (this.dedupe.size > this.dedupeCap) this.dedupe.delete(this.dedupe.keys().next().value!);
    }
    if (this.opts.onDecision !== undefined) {
      try {
        this.opts.onDecision(verdict, payout);
      } catch {
        this.hookErrors += 1;
      }
    }
    return verdict;
  }

  /** Post-verdict bookkeeping: ledger, merchant accounts, intent consumption. */
  private remember(p: PayoutRequest, ctx: PayoutContext, action: EffectiveAction): void {
    const prev = ctx.beneficiary;
    const verifiedHere = p.kind === 'VERIFICATION' && ctx.intent.status === 'ok' && ctx.intent.subjectRef !== undefined;
    let entry: BeneficiaryEntry = prev ?? { firstSeenMs: p.timestampMs };
    if (p.amountPaise <= ctx.microPaise) {
      entry = {
        ...entry,
        lastMicro: {
          atMs: p.timestampMs,
          amountPaise: p.amountPaise,
          ...(verifiedHere ? { verifiedSubject: ctx.intent.subjectRef! } : {}),
        },
      };
    }
    if (verifiedHere) {
      const subjects = entry.verifiedSubjects ?? [];
      if (!subjects.includes(ctx.intent.subjectRef!)) entry = { ...entry, verifiedSubjects: [...subjects, ctx.intent.subjectRef!].slice(-8) };
    }
    // Always set, even unchanged: the write is what refreshes recency —
    // otherwise a hot beneficiary could be evicted mid-activity and its
    // firstSeen would reset, producing spurious cooling REVIEWs.
    this.beneficiaries.set(p.beneficiaryRef, entry);
    if (p.kind === 'PA_SETTLEMENT' && p.merchantId !== undefined) this.merchants.observe(p.merchantId, p.beneficiaryRef, p.timestampMs);
    if (action !== 'DECLINE' && ctx.intent.status === 'ok' && p.intentId !== undefined) {
      this.intents.reserve(p.intentId, p.payoutId, p.amountPaise, p.sourceKeyId, p.approvalIds);
    }
  }

  private countBlock(ts: number): void {
    const rule = this.cfg.highAlertOnBlocks ?? { count: 5, windowMs: 10 * 60_000 };
    if (rule.count <= 0) return;
    this.recentBlocks.push(ts);
    while (this.recentBlocks.length > 0 && this.recentBlocks[0]! <= ts - rule.windowMs) this.recentBlocks.shift();
    if (this.recentBlocks.length > rule.count) this.recentBlocks.shift();
    if (this.highAlert === null && this.recentBlocks.length >= rule.count) {
      this.enterHighAlert('engine:block-burst', `${rule.count} BLOCK verdicts within ${Math.round(rule.windowMs / 60_000)} min`, ts);
    }
  }

  /**
   * Final payout status, so intent uses and baselines stay accurate. When
   * `sourceKeyId` is given, only the key that consumed the intent may report
   * on it — a `failed`/`reversed` report frees the intent for reuse, so it
   * is a money-lever and every release is audited.
   */
  reportOutcome(payoutId: string, outcome: PayoutOutcome, sourceKeyId?: string): boolean {
    const r = outcome === 'settled' ? this.intents.settle(payoutId, sourceKeyId) : this.intents.release(payoutId, sourceKeyId);
    if (r === 'denied') this.record({ atMs: this.now(), action: 'outcome.denied', actor: sourceKeyId ?? 'unknown', reason: `${outcome} reported for ${payoutId}` });
    else if (r === 'released' || r === 'settled') this.record({ atMs: this.now(), action: `outcome.${outcome}`, actor: sourceKeyId ?? 'in-process', reason: payoutId });
    return r === 'released' || r === 'settled';
  }

  registerIntent(intent: unknown, nowMs: number = this.now()): RegisterResult {
    return this.intents.register(intent, nowMs);
  }

  /** The in-memory audit ring (last 1000 entries, oldest first) — for the read-only analyst API and consoles. */
  get auditEntries(): readonly AuditEntry[] {
    return this.audit;
  }

  /**
   * Build, sign and register an intent in one call — the managed-intents
   * tier (gateway holds the signing key). The caller's system never touches
   * canonical JSON or key management; the trade-off is that this host can
   * mint, so prefer externally-signed intents in enforce mode.
   * `intentId` is derived from the signed fields when omitted, so a retried
   * mint is idempotent.
   */
  mintIntent(spec: MintSpec, actor: string, nowMs: number = this.now()): MintResult {
    const issuer = this.keyring.list().find((k) => k.keyId === spec.keyId);
    if (issuer === undefined) return { accepted: false, reason: `unknown signing keyId '${spec.keyId}'` };
    const unsigned = {
      kind: spec.kind,
      maxAmountPaise: spec.maxAmountPaise,
      beneficiaryRef: spec.beneficiaryRef,
      ...(spec.subjectRef !== undefined ? { subjectRef: spec.subjectRef } : {}),
      maxUses: spec.maxUses ?? 1,
      notBeforeMs: spec.notBeforeMs ?? nowMs,
      expiresAtMs: spec.expiresAtMs ?? nowMs + (spec.ttlMs ?? 300_000),
      issuer: issuer.issuer,
      keyId: spec.keyId,
      intentId: '',
    };
    const intentId = spec.intentId ?? `mint-${createHash('sha256').update(intentSigningPayload(unsigned as UnsignedIntent)).digest('base64url').slice(0, 32)}`;
    const intent = signIntent({ ...unsigned, intentId }, spec.key);
    const res = this.intents.register(intent, nowMs);
    if (res.accepted) this.record({ atMs: nowMs, action: 'intent.minted', actor, reason: `${intentId} ${spec.kind} ₹${spec.maxAmountPaise / 100} via ${spec.keyId}` });
    return { ...res, intentId };
  }

  // ----------------------------------------------------------- state & audit

  get alertState(): AlertState {
    return this.highAlert !== null ? 'HIGH_ALERT' : 'NORMAL';
  }

  /** Alert state that would apply at `atMs` (includes the calendar). */
  alertStateAt(atMs: number): AlertState {
    return this.highAlert !== null ? 'HIGH_ALERT' : this.calendar.window(atMs) !== null ? 'HOLIDAY' : 'NORMAL';
  }

  get highAlertInfo(): { readonly since: number; readonly reason: string } | null {
    return this.highAlert;
  }

  get currentMode(): { readonly mode: Mode; readonly modeByKind: Partial<Record<IntentKind, Mode>> } {
    return { mode: this.mode, modeByKind: { ...this.modeByKind } };
  }

  /** Raising the alert needs no credential: anyone may pull the alarm. */
  raiseHighAlert(actor: string, reason: string): void {
    this.enterHighAlert(actor, reason, this.now());
  }

  private enterHighAlert(actor: string, reason: string, atMs: number): void {
    if (this.highAlert !== null) return;
    this.highAlert = { since: atMs, reason };
    const e = this.record({ atMs: this.now(), action: 'alert.enter', actor, reason, from: 'NORMAL', to: 'HIGH_ALERT' });
    this.fireAlertChange('NORMAL', 'HIGH_ALERT', e);
  }

  /**
   * Clear HIGH_ALERT. Never automatic: the advisory says assume persistence.
   * Needs the admin token; every attempt (good or bad) is audited.
   */
  resetHighAlert(cred: Credential): void {
    this.authorize(cred, 'alert.reset');
    if (this.highAlert === null) return;
    this.highAlert = null;
    this.recentBlocks.length = 0;
    const e = this.record({ atMs: this.now(), action: 'alert.reset', actor: cred.actor, reason: cred.reason, from: 'HIGH_ALERT', to: 'NORMAL' });
    this.fireAlertChange('HIGH_ALERT', 'NORMAL', e);
  }

  /** Change the mode globally or for one kind. Admin only, audited. */
  setMode(mode: Mode, cred: Credential, kind?: IntentKind): void {
    if (mode !== 'shadow' && mode !== 'advise' && mode !== 'enforce') throw new TypeError('mode must be shadow, advise or enforce');
    this.authorize(cred, 'mode.set');
    const from = kind !== undefined ? (this.modeByKind[kind] ?? this.mode) : this.mode;
    if (kind !== undefined) this.modeByKind[kind] = mode;
    else this.mode = mode;
    this.record({ atMs: this.now(), action: kind !== undefined ? `mode.set:${kind}` : 'mode.set', actor: cred.actor, reason: cred.reason, from, to: mode });
  }

  addCanaries(c: { beneficiaryRefs?: readonly string[]; sourceKeyIds?: readonly string[]; intentIds?: readonly string[] }, cred: Credential): number {
    this.authorize(cred, 'canary.add');
    const n = this.canaries.add(c);
    this.record({ atMs: this.now(), action: 'canary.add', actor: cred.actor, reason: cred.reason, to: String(n) });
    return n;
  }

  /**
   * Revoke an issuer signing key without a redeploy — the incident response
   * to a compromised LOS/settlement key. Every intent it signed fails
   * verification on the next evaluation (generation bump). The revocation is
   * carried in the snapshot so a restart cannot silently un-revoke; keyIds
   * are tombstones and must never be reused for a new key. Admin + audited.
   */
  revokeIssuerKey(keyId: string, cred: Credential): boolean {
    this.authorize(cred, 'key.revoke');
    const ok = this.keyring.revoke(keyId);
    this.record({ atMs: this.now(), action: ok ? 'key.revoked' : 'key.revoke.unknown', actor: cred.actor, reason: cred.reason, to: keyId });
    return ok;
  }

  /** Explicit notice from the merchant-onboarding system that a settlement account changed. */
  noteMerchantAccountChange(merchantId: string, beneficiaryRef: string, atMs: number): void {
    if (looksLikeRawIdentifier(beneficiaryRef)) throw new TypeError('beneficiaryRef looks raw; hash it first');
    this.merchants.noteAccountChange(merchantId, beneficiaryRef, atMs);
  }

  auditTrail(): readonly AuditEntry[] {
    return this.audit.slice();
  }

  /**
   * Roll back this replica's local consumption of a payout — the shared
   * commit reported the reservation belongs to someone else or lost the
   * uses race (ADR 0004). Releases the intents and evicts the dedupe verdict
   * so a re-evaluate sees the truth. Internal use only — not an outcome.
   */
  unbind(payoutId: string, sourceKeyId?: string): void {
    this.intents.release(payoutId, sourceKeyId);
    this.dedupe.delete(`${String(sourceKeyId ?? '')}\n${payoutId}`);
  }

  /**
   * Reconcile control-plane state learned from the shared backend (ADR 0004).
   * Not an admin op — the admin already acted on the writer replica; this one
   * is converging. Fields absent from `s` are left alone; fields present
   * (including `highAlert: null`) apply. Every transition is audited locally.
   */
  applyControl(s: SharedControlState, atMs = this.now()): void {
    if (s.highAlert !== undefined) {
      if (s.highAlert !== null && this.highAlert === null) {
        this.highAlert = { since: s.highAlert.since, reason: s.highAlert.reason };
        const e = this.record({ atMs, action: 'alert.enter', actor: 'shared-control', reason: s.highAlert.reason, from: 'NORMAL', to: 'HIGH_ALERT' });
        this.fireAlertChange('NORMAL', 'HIGH_ALERT', e);
      } else if (s.highAlert === null && this.highAlert !== null) {
        this.highAlert = null;
        this.recentBlocks.length = 0;
        const e = this.record({ atMs, action: 'alert.reset', actor: 'shared-control', reason: 'remote reset', from: 'HIGH_ALERT', to: 'NORMAL' });
        this.fireAlertChange('HIGH_ALERT', 'NORMAL', e);
      }
    }
    if (s.mode !== undefined && s.mode !== this.mode) {
      const from = this.mode;
      this.mode = s.mode;
      this.record({ atMs, action: 'mode.set', actor: 'shared-control', reason: 'shared control', from, to: s.mode });
    }
    if (s.modeByKind !== undefined) {
      for (const kind of Object.keys(s.modeByKind) as IntentKind[]) {
        const next = s.modeByKind[kind];
        if (next === undefined) continue;
        const from = this.modeByKind[kind] ?? this.mode;
        if (next === null) {
          if (this.modeByKind[kind] !== undefined) {
            delete this.modeByKind[kind];
            this.record({ atMs, action: `mode.clear:${kind}`, actor: 'shared-control', reason: 'shared control', from, to: 'inherit' });
          }
        } else if (next !== this.modeByKind[kind]) {
          this.modeByKind[kind] = next;
          this.record({ atMs, action: `mode.set:${kind}`, actor: 'shared-control', reason: 'shared control', from, to: next });
        }
      }
    }
    for (const keyId of s.revokedKeyIds ?? []) {
      if (this.keyring.revoke(keyId)) {
        this.record({ atMs, action: 'key.revoked', actor: 'shared-control', reason: 'shared control', to: keyId });
      }
    }
  }

  private authorize(cred: Credential, action: string): void {
    const expected = this.cfg.adminTokenSha256;
    const ok =
      expected !== undefined &&
      /^[0-9a-f]{64}$/i.test(expected) &&
      typeof cred.adminToken === 'string' &&
      timingSafeEqual(sha256(cred.adminToken), Buffer.from(expected, 'hex'));
    if (!ok) {
      this.record({ atMs: this.now(), action: `${action}.denied`, actor: cred.actor, reason: cred.reason });
      throw new AuthorizationError(expected === undefined ? 'no admin credential configured' : 'admin token rejected');
    }
  }

  private record(e: AuditEntry): AuditEntry {
    this.audit.push(e);
    if (this.audit.length > 1_000) this.audit.shift();
    try {
      this.opts.onAudit?.(e);
    } catch {
      this.hookErrors += 1;
    }
    return e;
  }

  private fireAlertChange(from: AlertState, to: AlertState, e: AuditEntry): void {
    try {
      this.opts.onAlertChange?.(from, to, e);
    } catch {
      this.hookErrors += 1;
    }
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  // ------------------------------------------------------------ observability

  get metrics(): EngineMetrics & {
    readonly deduped: number;
    readonly hookErrors: number;
    readonly effective: Readonly<Record<EffectiveAction, number>>;
    readonly intents: number;
    readonly beneficiaries: number;
    readonly canaries: number;
    readonly highAlert: boolean;
  } {
    return {
      ...this.engine.metrics,
      deduped: this.dedupedCount,
      hookErrors: this.hookErrors,
      effective: { ...this.effective },
      intents: this.intents.store.size,
      beneficiaries: this.beneficiaries.size,
      canaries: this.canaries.size,
      highAlert: this.highAlert !== null,
    };
  }

  get ruleNames(): readonly string[] {
    return this.engine.ruleNames;
  }

  replaceRules(rules: readonly PayoutRule[]): void {
    this.engine.replaceRules(rules);
  }

  // ------------------------------------------------------------- persistence

  exportState(): FirewallSnapshot {
    return {
      version: 1,
      exportedAtMs: this.now(),
      highAlert: this.highAlert,
      mode: this.mode,
      modeByKind: { ...this.modeByKind },
      intents: this.intents.exportState(),
      beneficiaries: this.beneficiaries.exportState(),
      merchants: this.merchants.exportState(),
      canaries: this.canaries.exportState(),
      rules: this.engine.exportState(),
      audit: this.audit.slice(-200),
      issuers: { revoked: this.keyring.list().flatMap((k) => (k.revoked === true ? [k.keyId] : [])) },
      recentBlocks: [...this.recentBlocks],
    };
  }

  /**
   * Restore a snapshot. HIGH_ALERT survives restarts — a reboot must not
   * be a way to clear it. Mode is NOT restored from the snapshot: config
   * is the source of truth, so a tampered state file cannot flip enforce
   * back to shadow.
   */
  restoreState(s: FirewallSnapshot): void {
    if (s.version !== 1) throw new TypeError(`unsupported snapshot version ${String(s.version)}`);
    if (s.highAlert !== null) this.highAlert = { ...s.highAlert };
    this.intents.restoreState(s.intents);
    this.beneficiaries.restoreState((s.beneficiaries as [string, BeneficiaryEntry][]) ?? []);
    this.merchants.restoreState((s.merchants as [string, MerchantEntry][]) ?? []);
    this.canaries.add((s.canaries as Parameters<CanaryRegistry['add']>[0]) ?? {});
    this.engine.restoreState(s.rules ?? {});
    // Revocations survive restarts — a reboot must not resurrect a burned key.
    for (const keyId of s.issuers?.revoked ?? []) this.keyring.revoke(keyId);
    // The burst counter too: a reboot mid-burst must not zero it.
    for (const t of s.recentBlocks ?? []) if (typeof t === 'number' && Number.isFinite(t)) this.recentBlocks.push(t);
    for (const e of s.audit ?? []) this.audit.push(e);
  }
}

export class AuthorizationError extends Error {
  override readonly name = 'AuthorizationError';
}
