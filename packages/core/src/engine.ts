// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { Verdict, type Evaluation, type RuleError, type RuleHit } from './types.js';

/**
 * A synchronous rule over request type `Req` with context `Ctx`.
 * Same contract as Krediwall's `Rule`, made generic (see docs/adr/0001-engine.md).
 */
export interface Rule<Req, Ctx> {
  readonly name: string;
  evaluate(req: Req, ctx: Ctx): RuleHit | null;
  reset?(): void;
  exportState?(): unknown;
  restoreState?(state: unknown): void;
  stats?(): Readonly<Record<string, number>>;
}

export interface EngineOptions<Req> {
  /** Shape check. A non-null return is the (PII-free) problem → degraded REVIEW. */
  readonly validate: (req: Req) => string | null;
  readonly onRuleError?: (rule: string, error: unknown) => void;
}

export const severity = (v: Verdict): number => (v === Verdict.Block ? 2 : v === Verdict.Review ? 1 : 0);

const EMPTY_HITS: readonly RuleHit[] = [];
const EMPTY_ERRORS: readonly RuleError[] = [];
export const LATENCY_BUCKETS_MICROS: readonly number[] = [50, 100, 250, 500, 1_000, 2_500, 5_000];

export interface EngineMetrics {
  readonly evaluated: number;
  readonly verdicts: { readonly allow: number; readonly review: number; readonly block: number };
  readonly ruleHits: Readonly<Record<string, number>>;
  readonly ruleErrors: Readonly<Record<string, number>>;
  readonly degraded: number;
  readonly latencyMicros: { readonly buckets: readonly number[]; readonly counts: readonly number[]; readonly sum: number };
}

/**
 * Ordered, synchronous evaluation loop — Krediwall semantics:
 * shape validation first (malformed → REVIEW + degraded, never ALLOW);
 * rules in registration order; a throwing rule is isolated into
 * `ruleErrors` (→ degraded) and the loop continues; hits fold to the worst
 * severity; the first BLOCK short-circuits.
 */
export class Engine<Req, Ctx> {
  private rules: readonly Rule<Req, Ctx>[];
  private readonly validate: EngineOptions<Req>['validate'];
  private readonly onRuleError: EngineOptions<Req>['onRuleError'];
  private evaluated = 0;
  private allow = 0;
  private review = 0;
  private block = 0;
  private degradedCount = 0;
  private latencySum = 0;
  private readonly latencyCounts = new Array<number>(LATENCY_BUCKETS_MICROS.length + 1).fill(0);
  private readonly hitCounts = new Map<string, number>();
  private readonly errorCounts = new Map<string, number>();

  constructor(rules: readonly Rule<Req, Ctx>[], options: EngineOptions<Req>) {
    this.rules = rules.slice();
    this.validate = options.validate;
    this.onRuleError = options.onRuleError;
  }

  get ruleNames(): readonly string[] {
    return this.rules.map((r) => r.name);
  }

  evaluate(req: Req, ctx: Ctx): Evaluation {
    const start = performance.now();
    let worst: Verdict = Verdict.Allow;
    let hits: RuleHit[] | null = null;
    let errors: RuleError[] | null = null;
    let problem: string | null;
    try {
      problem = this.validate(req);
    } catch {
      problem = 'shape validation threw';
    }
    if (problem !== null) {
      errors = [{ rule: 'engine', message: `malformed request: ${problem}` }];
      worst = Verdict.Review;
    } else {
      for (const rule of this.rules) {
        let hit: RuleHit | null;
        try {
          hit = rule.evaluate(req, ctx);
        } catch (e) {
          (errors ??= []).push({ rule: rule.name, message: e instanceof Error ? e.message : String(e) });
          this.errorCounts.set(rule.name, (this.errorCounts.get(rule.name) ?? 0) + 1);
          try {
            this.onRuleError?.(rule.name, e);
          } catch {
            /* a faulty hook must not break the hot path */
          }
          continue;
        }
        if (hit === null) continue;
        this.hitCounts.set(hit.rule, (this.hitCounts.get(hit.rule) ?? 0) + 1);
        (hits ??= []).push(hit);
        if (severity(hit.verdict) > severity(worst)) {
          worst = hit.verdict;
          if (worst === Verdict.Block) break;
        }
      }
    }
    // A rule that threw means coverage was incomplete: never let that read as a clean ALLOW.
    if (errors !== null && worst === Verdict.Allow) worst = Verdict.Review;
    const elapsed = (performance.now() - start) * 1000;
    this.evaluated += 1;
    if (worst === Verdict.Block) this.block += 1;
    else if (worst === Verdict.Review) this.review += 1;
    else this.allow += 1;
    if (errors !== null) this.degradedCount += 1;
    this.latencySum += elapsed;
    let b = 0;
    while (b < LATENCY_BUCKETS_MICROS.length && elapsed > LATENCY_BUCKETS_MICROS[b]!) b += 1;
    this.latencyCounts[b]! += 1;
    return {
      verdict: worst,
      hits: hits ?? EMPTY_HITS,
      ruleErrors: errors ?? EMPTY_ERRORS,
      degraded: errors !== null,
      elapsedMicros: elapsed,
    };
  }

  get metrics(): EngineMetrics {
    return {
      evaluated: this.evaluated,
      verdicts: { allow: this.allow, review: this.review, block: this.block },
      ruleHits: Object.fromEntries(this.hitCounts),
      ruleErrors: Object.fromEntries(this.errorCounts),
      degraded: this.degradedCount,
      latencyMicros: { buckets: LATENCY_BUCKETS_MICROS, counts: this.latencyCounts.slice(), sum: this.latencySum },
    };
  }

  ruleStats(): Record<string, Readonly<Record<string, number>>> {
    const out: Record<string, Readonly<Record<string, number>>> = {};
    for (const r of this.rules) {
      const s = r.stats?.();
      if (s !== undefined) out[r.name] = s;
    }
    return out;
  }

  /** Hot-swap rules; same-named rules carry their state across (Krediwall `replaceRules`). */
  replaceRules(rules: readonly Rule<Req, Ctx>[]): void {
    const old = new Map(this.rules.map((r) => [r.name, r] as const));
    for (const r of rules) {
      const s = old.get(r.name)?.exportState?.();
      if (s !== undefined) r.restoreState?.(s);
    }
    this.rules = rules.slice();
  }

  exportState(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of this.rules) {
      const s = r.exportState?.();
      if (s !== undefined) out[r.name] = s;
    }
    return out;
  }

  restoreState(state: Readonly<Record<string, unknown>>): void {
    for (const r of this.rules) {
      const s = state[r.name];
      if (s !== undefined) r.restoreState?.(s);
    }
  }

  reset(): void {
    for (const r of this.rules) r.reset?.();
  }
}
