// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { Verdict, type CommitResult, type EffectiveAction, type IntentKind, type Payrekha, type PayoutRequest, type PayoutVerdict, type SharedControlState, type SharedStateBackend } from '@payrekha/core';

export interface SharedStateOptions {
  readonly backend: SharedStateBackend;
  /**
   * Kinds whose intent consumption must go through the shared commit —
   * the lender's consistency knob (ADR 0004). 'all' (default) commits every
   * intent-bound payout; a list scopes it, e.g. `['VDA_WITHDRAWAL']`.
   */
  readonly commitPolicy?: 'all' | readonly IntentKind[];
  /**
   * Control-state convergence poll. Default 2000ms — the commit transaction
   * already checks the control generation inline, so this is cache warming
   * for the read path and readiness, not the safety mechanism.
   */
  readonly controlPollMs?: number;
}

const actionFor = (verdict: PayoutVerdict['verdict'], mode: PayoutVerdict['mode']): EffectiveAction =>
  mode === 'shadow' ? 'ALLOW' : verdict === Verdict.Block ? 'DECLINE' : verdict === Verdict.Review ? 'HOLD' : 'ALLOW';

/**
 * The ADR 0004 boundary between the synchronous engine and the shared store.
 * `Payrekha.evaluate` never does I/O; the gateway calls `finalize` after it,
 * which makes the store authoritative before the verdict leaves:
 *
 * - miss-fetch an intent another replica registered,
 * - atomically commit the reservation + cited-intent uses + control-gen check,
 * - on conflict roll the local consumption back (`unbind`) and re-evaluate
 *   with fresher facts,
 * - on store failure fail closed: DECLINE for enforce-mode payouts, degraded
 *   evidence everywhere else. There is no "allow on outage" path.
 */
export class SharedStateDriver {
  private gen = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Reachability we observed — feeds /readyz through setSharedReady. */
  private reachable = true;

  constructor(
    private readonly fw: Payrekha,
    private readonly o: SharedStateOptions,
    private readonly onError: (where: string, err: unknown) => void,
    private readonly setSharedReady: (ok: boolean) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** Poll for control convergence; the first commit also converges on demand. */
  start(): void {
    void this.refreshControl('boot');
    this.timer = setInterval(() => void this.refreshControl('poll'), this.o.controlPollMs ?? 2_000);
    this.timer.unref();
  }

  async close(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    await this.o.backend.close?.();
  }

  inPolicy(kind: IntentKind | undefined): boolean {
    const p = this.o.commitPolicy ?? 'all';
    return p === 'all' || (kind !== undefined && p.includes(kind));
  }

  private async refreshControl(where: string): Promise<void> {
    try {
      const s = await this.o.backend.readControl();
      this.gen = s.gen;
      this.fw.applyControl(s);
      this.markReachable(true);
    } catch (e) {
      this.onError(`shared-control-${where}`, e);
      this.markReachable(false);
    }
  }

  private markReachable(ok: boolean): void {
    if (ok === this.reachable) return;
    this.reachable = ok;
    this.setSharedReady(ok);
  }

  /**
   * Admin control ops (alert/mode/revocation): write the row, then converge.
   * Throws when the store is down — the caller turns that into 503.
   */
  async pushControl(mutate: (cur: SharedControlState) => SharedControlState): Promise<void> {
    await this.o.backend.writeControl(mutate);
    const s = await this.o.backend.readControl();
    this.gen = s.gen;
    this.fw.applyControl(s);
    this.markReachable(true);
  }

  /** Registration write-through — awaited before the call reports success. */
  async writeThroughIntent(intent: unknown): Promise<void> {
    const i = intent as { intentId?: unknown };
    const rec = typeof i?.intentId === 'string' ? this.fw.intents.get(i.intentId) : undefined;
    if (rec === undefined || rec.verification !== 'ok') return;
    await this.o.backend.putIntent(rec.intent);
  }

  /** Outcome write-through — the reservation row is the cross-replica truth. */
  async applyOutcome(payoutId: string, outcome: 'settled' | 'failed' | 'reversed', sourceKeyId: string): Promise<boolean> {
    return outcome === 'settled' ? this.o.backend.settleReservation(payoutId, sourceKeyId) : this.o.backend.releaseReservation(payoutId, sourceKeyId);
  }

  /**
   * Make a locally-produced verdict authoritative. Returns the verdict to
   * send — possibly a re-evaluated one, the stored verdict for a duplicate
   * payoutId, or a fail-closed DECLINE when the store is unreachable.
   */
  async finalize(v: PayoutVerdict, p: PayoutRequest): Promise<PayoutVerdict> {
    if (typeof p !== 'object' || p === null) return v;
    v = await this.missFetch(v, p);
    v = await this.staleSync(v, p);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const held = this.fw.intents.reservationOf(p.payoutId);
      if (held === undefined || !this.inPolicy(p.kind)) return v;
      const intents = [held.intentId, ...held.approvalIds].flatMap((id) => {
        const rec = this.fw.intents.get(id);
        return rec === undefined ? [] : [rec.intent];
      });
      let res: CommitResult;
      try {
        res = await this.o.backend.commit({
          payoutId: p.payoutId,
          sourceKeyId: p.sourceKeyId ?? '',
          intentId: held.intentId,
          approvalIds: held.approvalIds,
          intents,
          amountPaise: held.amountPaise,
          verdict: v,
          controlGen: this.gen,
        });
      } catch (e) {
        return this.failClosed(v, p, e);
      }
      if (!('conflict' in res)) {
        this.gen = res.gen;
        this.markReachable(true);
        // The commit carries authoritative counters — converge every time so
        // cross-replica releases and other replicas' spends stop drifting.
        for (const [id, c] of Object.entries(res.counters ?? {})) this.fw.intents.syncCounters(id, c.uses, c.usedPaise);
        return v;
      }
      // Lost a race: local consumption was premature — roll it back and
      // re-evaluate with fresher facts.
      this.fw.unbind(p.payoutId, p.sourceKeyId);
      if (res.conflict === 'payoutId') return this.replayStored(res.verdict, v);
      if (res.conflict === 'control') {
        await this.refreshControl('commit');
        v = this.fw.evaluate(p);
        continue;
      }
      // res.conflict === 'uses'
      let st: { uses: number; usedPaise: number } | undefined = res.uses !== undefined && res.usedPaise !== undefined ? { uses: res.uses, usedPaise: res.usedPaise } : undefined;
      if (st === undefined) {
        try {
          st = await this.o.backend.intentState(res.intentId);
        } catch (e) {
          return this.failClosed(v, p, e);
        }
      }
      if (st !== undefined) this.fw.intents.syncCounters(res.intentId, st.uses, st.usedPaise);
      v = this.fw.evaluate(p);
    }
    return v;
  }

  /** Fetch intents cited but unknown locally — they were registered on another replica. */
  private async missFetch(v: PayoutVerdict, p: PayoutRequest): Promise<PayoutVerdict> {
    const cited = [p.intentId, ...(p.approvalIds ?? [])].filter((x): x is string => typeof x === 'string' && x !== '');
    const missing = cited.filter((id) => this.fw.intents.get(id) === undefined);
    if (missing.length === 0) return v;
    let found = false;
    for (const id of missing) {
      try {
        const i = await this.o.backend.getIntent(id);
        if (i !== undefined) {
          this.fw.registerIntent(i, this.now());
          found = true;
        }
      } catch (e) {
        this.onError('shared-miss-fetch', e);
        return v;
      }
    }
    if (!found) return v;
    this.fw.unbind(p.payoutId, p.sourceKeyId);
    return this.fw.evaluate(p);
  }

  /**
   * A local `intent.*` BLOCK may be built on stale counters — an outcome
   * released on another replica or uses spent elsewhere. Pull authoritative
   * counters for the cited intents and re-evaluate once if anything moved.
   */
  private async staleSync(v: PayoutVerdict, p: PayoutRequest): Promise<PayoutVerdict> {
    if (v.verdict !== Verdict.Block || !v.hits.some((h) => h.rule.startsWith('intent.'))) return v;
    const cited = [p.intentId, ...(p.approvalIds ?? [])].filter((x): x is string => typeof x === 'string' && x !== '');
    let moved = false;
    for (const id of cited) {
      try {
        const st = await this.o.backend.intentState(id);
        if (st !== undefined && this.fw.intents.get(id) !== undefined) {
          this.fw.intents.syncCounters(id, st.uses, st.usedPaise);
          moved = true;
        }
      } catch (e) {
        this.onError('shared-stale-sync', e);
        return v;
      }
    }
    if (!moved) return v;
    this.fw.unbind(p.payoutId, p.sourceKeyId);
    return this.fw.evaluate(p);
  }

  /**
   * The payoutId belongs to another replica — replay its stored verdict with
   * today's mode, exactly like the local dedupe cache does.
   */
  private replayStored(stored: unknown, v: PayoutVerdict): PayoutVerdict {
    if (stored === null || typeof stored !== 'object' || typeof (stored as PayoutVerdict).verdict !== 'string') {
      return this.synthesize(v, Verdict.Review, 'stored reservation verdict is unreadable — holding for review');
    }
    const s = stored as PayoutVerdict;
    return { ...s, mode: v.mode, effectiveAction: actionFor(s.verdict, v.mode), deduped: true };
  }

  private synthesize(v: PayoutVerdict, verdict: PayoutVerdict['verdict'], reason: string): PayoutVerdict {
    const hit = { rule: 'store.commit-failed', verdict, reason, evidence: {} };
    const next = { ...v, verdict, hits: [...v.hits, hit], degraded: true, riskScore: 1 };
    return { ...next, effectiveAction: actionFor(verdict, v.mode) };
  }

  private failClosed(v: PayoutVerdict, p: PayoutRequest, e: unknown): PayoutVerdict {
    this.fw.unbind(p.payoutId, p.sourceKeyId);
    this.markReachable(false);
    const msg = e instanceof Error ? e.message : 'unknown error';
    return v.mode === 'enforce'
      ? this.synthesize(v, Verdict.Block, `shared state commit unreachable (${msg.slice(0, 120)}) — failing closed, no allow-on-outage path`)
      : this.synthesize(v, Verdict.Review, `shared state commit unreachable (${msg.slice(0, 120)}) — verdict is not authoritative`);
  }
}
