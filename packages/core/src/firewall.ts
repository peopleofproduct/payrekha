// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { createHash, timingSafeEqual } from 'node:crypto';
import { Calendar, type CalendarConfig, type CalendarWindow } from './calendar.js';
import { Engine, type EngineMetrics, type Rule } from './engine.js';
import { looksLikeRawIdentifier } from './hash.js';
import { Keyring, type IssuerKey } from './intent.js';
import { BeneficiaryLedger, CanaryRegistry, MerchantLedger, type BeneficiaryEntry, type CanarySets, type MerchantEntry } from './ledger.js';
import { IntentRegistry, MemoryIntentStore, type IntentCheck, type IntentStore, type RegisterResult } from './registry.js';
import {
  CHANNELS,
  INTENT_KINDS,
  Verdict,
  type AlertState,
  type AuditEntry,
  type EffectiveAction,
  type IntentKind,
  type Mode,
  type PayoutOutcome,
  type PayoutRequest,
  type PayoutVerdict,
} from './types.js';

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
  readonly multipliers?: Partial<Record<AlertState, Partial<Multipliers>>>;
  /** Enter HIGH_ALERT after this many BLOCK verdicts within `windowMs`. `count: 0` disables. */
  readonly highAlertOnBlocks?: { readonly count: number; readonly windowMs: number };
  readonly calendar?: CalendarConfig;
  /** Micro-value threshold (paise) for the ledger's probe memory. Default ₹10. */
  readonly microPaise?: number;
  /** Retry dedupe window (payoutIds). Default 10,000. */
  readonly dedupeCapacity?: number;
  readonly ledgerCapacity?: number;
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
  /** Clock for audit entries only. Verdicts use `payout.timestampMs`. */
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
}

const isStr = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Shape check. Messages name the field, never echo its value (no PII in errors). */
export function payoutShapeProblem(x: unknown): string | null {
  if (typeof x !== 'object' || x === null) return 'payout must be an object';
  const p = x as Record<string, unknown>;
  if (!isStr(p['payoutId'], 128)) return 'payoutId';
  if (!INTENT_KINDS.includes(p['kind'] as IntentKind)) return 'kind';
  if (p['intentId'] !== undefined && typeof p['intentId'] !== 'string') return 'intentId';
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
  if (!Number.isSafeInteger(p['timestampMs']) || (p['timestampMs'] as number) <= 0) return 'timestampMs';
  return null;
}

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();

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
    const cached = typeof payout?.payoutId === 'string' ? this.dedupe.get(payout.payoutId) : undefined;
    if (cached !== undefined) {
      this.dedupedCount += 1;
      return { ...cached, deduped: true };
    }
    const ts = Number.isSafeInteger(payout?.timestampMs) ? payout.timestampMs : 0;
    const calendarWindow = ts > 0 ? this.calendar.window(ts) : null;
    const alertState: AlertState = this.highAlert !== null ? 'HIGH_ALERT' : calendarWindow !== null ? 'HOLIDAY' : 'NORMAL';
    const wellFormed = payoutShapeProblem(payout) === null;
    const required = alertState === 'HIGH_ALERT' || (wellFormed && this.cfg.requireIntent?.[payout.kind] !== false);
    const ctx: PayoutContext = {
      nowMs: ts,
      alertState,
      multipliers: this.multipliers[alertState],
      calendarWindow,
      intent: wellFormed ? this.intents.check(payout, required) : { status: 'missing', required },
      beneficiary: wellFormed ? this.beneficiaries.get(payout.beneficiaryRef) : undefined,
      merchant: wellFormed && payout.merchantId !== undefined ? this.merchants.get(payout.merchantId) : undefined,
      canaries: this.canaries,
      microPaise: this.cfg.microPaise ?? 1_000,
    };
    const ev = this.engine.evaluate(payout, ctx);
    const kind = wellFormed ? payout.kind : undefined;
    const mode = (kind !== undefined ? this.modeByKind[kind] : undefined) ?? this.mode;
    const effectiveAction: EffectiveAction =
      mode === 'shadow' ? 'ALLOW' : ev.verdict === Verdict.Block ? 'DECLINE' : ev.verdict === Verdict.Review ? 'HOLD' : 'ALLOW';
    this.effective[effectiveAction] += 1;

    for (const h of ev.hits) {
      if (h.raiseAlert === 'HIGH_ALERT') this.enterHighAlert(`rule:${h.rule}`, h.reason, ts);
    }
    if (ev.verdict === Verdict.Block) this.countBlock(ts);

    if (wellFormed) this.remember(payout, ctx, effectiveAction);

    this.seq += 1;
    const decisionId = `pd_${createHash('sha256').update(`${String(payout?.payoutId)}|${ts}|${this.seq}`).digest('base64url').slice(0, 22)}`;
    const verdict: PayoutVerdict = {
      ...ev,
      decisionId,
      payoutId: String(payout?.payoutId ?? ''),
      mode,
      alertState,
      effectiveAction,
      deduped: false,
    };
    if (typeof payout?.payoutId === 'string') {
      this.dedupe.set(payout.payoutId, verdict);
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
    if (entry !== prev) this.beneficiaries.set(p.beneficiaryRef, entry);
    if (p.kind === 'PA_SETTLEMENT' && p.merchantId !== undefined) this.merchants.observe(p.merchantId, p.beneficiaryRef, p.timestampMs);
    if (action !== 'DECLINE' && ctx.intent.status === 'ok' && p.intentId !== undefined) {
      this.intents.reserve(p.intentId, p.payoutId, p.amountPaise);
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

  /** Final payout status, so intent uses and baselines stay accurate. */
  reportOutcome(payoutId: string, outcome: PayoutOutcome): boolean {
    if (outcome === 'settled') return this.intents.settle(payoutId);
    return this.intents.release(payoutId);
  }

  registerIntent(intent: unknown, nowMs: number = this.now()): RegisterResult {
    return this.intents.register(intent, nowMs);
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

  /** Explicit notice from the merchant-onboarding system that a settlement account changed. */
  noteMerchantAccountChange(merchantId: string, beneficiaryRef: string, atMs: number): void {
    if (looksLikeRawIdentifier(beneficiaryRef)) throw new TypeError('beneficiaryRef looks raw; hash it first');
    this.merchants.noteAccountChange(merchantId, beneficiaryRef, atMs);
  }

  auditTrail(): readonly AuditEntry[] {
    return this.audit.slice();
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
    for (const e of s.audit ?? []) this.audit.push(e);
  }
}

export class AuthorizationError extends Error {
  override readonly name = 'AuthorizationError';
}
