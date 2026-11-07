// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import type { Intent, IntentKind, Mode } from './types.js';

/**
 * ADR 0004 — the active-active seam. Everything `Payrekha.evaluate` reads
 * stays advisory; this backend owns the *authoritative* facts: reservation
 * bindings, intent use counters, and control-plane state (alert, mode,
 * revocations). The verdict path never does I/O — only the caller
 * boundary awaits `commit`, and only for kinds in `commitPolicy`.
 *
 * Invariant: an ALLOW for an intent-bound payout is returned only after
 * `commit` confirms the reservation landed and every cited intent gave up
 * its use atomically.
 */

/** What the gateway asks the backend to commit after a local ALLOW/HOLD verdict. */
export interface ReservationCommit {
  readonly payoutId: string;
  readonly sourceKeyId: string;
  readonly intentId: string;
  readonly approvalIds: readonly string[];
  /** Immutable cited intents — upserted so use-accounting works wherever they were registered. */
  readonly intents: readonly Intent[];
  readonly amountPaise: number;
  /** Serialised PayoutVerdict — replayed to later retries of this payoutId. */
  readonly verdict: unknown;
  /** The replica's last applied control generation — compared inside the commit transaction. */
  readonly controlGen: number;
}

export type CommitResult =
  | { readonly committed: true; readonly gen: number; readonly counters?: Record<string, { readonly uses: number; readonly usedPaise: number }> }
  /** Another replica owns this payoutId — replay its stored verdict. */
  | { readonly conflict: 'payoutId'; readonly verdict: unknown }
  /** The uses race was lost between check and commit — refresh counters, re-evaluate. */
  | { readonly conflict: 'uses'; readonly intentId: string; readonly uses?: number | undefined; readonly usedPaise?: number | undefined }
  /** Control state moved (alert/mode/revocation) — refresh, re-evaluate. */
  | { readonly conflict: 'control'; readonly gen: number };

/** Control-plane state shared across replicas (ADR 0004 §3). */
export interface SharedControlState {
  readonly gen: number;
  /** `null` explicitly means NORMAL — a remote reset must clear a local alert. */
  readonly highAlert?: { readonly since: number; readonly reason: string } | null | undefined;
  readonly mode?: Mode | undefined;
  /** `Mode` sets an override; `null` clears one. Keys absent are untouched. */
  readonly modeByKind?: Partial<Record<IntentKind, Mode | null>> | undefined;
  readonly revokedKeyIds?: readonly string[] | undefined;
}

export interface SharedStateBackend {
  /** Human-readable location for logs. Must not contain credentials. */
  readonly describe: string;
  /** Registration write-through — awaited before a register/mint call succeeds. */
  putIntent(intent: Intent): Promise<void>;
  /** Miss-fetch: an intent registered on another replica. */
  getIntent(intentId: string): Promise<Intent | undefined>;
  /** The atomic commit — reservation insert + per-intent conditional use + control-gen compare. */
  commit(c: ReservationCommit): Promise<CommitResult>;
  /** Authoritative counters after a `conflict(uses)` — the other replica's commits won. */
  intentState(intentId: string): Promise<{ readonly uses: number; readonly usedPaise: number } | undefined>;
  /** Free a reservation and give every cited use back (failed/reversed outcome). Bound to the key that authorized it, like the local registry. */
  releaseReservation(payoutId: string, sourceKeyId: string): Promise<boolean>;
  /** Tombstone a reservation as settled — the payoutId stays bound. */
  settleReservation(payoutId: string, sourceKeyId: string): Promise<boolean>;
  /** The control row — alert/mode/revocations + generation. */
  readControl(): Promise<SharedControlState>;
  /**
   * CAS a control change inside one transaction: `mutate` sees the current
   * row and returns the next state. False when another writer landed first —
   * the caller retries with a fresh read.
   */
  writeControl(mutate: (cur: SharedControlState) => SharedControlState): Promise<boolean>;
  close?(): Promise<void>;
}

/**
 * In-memory backend — the default for tests, drills and single-node embeds
 * that want the shared flow without a database. Atomicity is free
 * (single-threaded), which is exactly what makes it useful for proving the
 * commit/conflict machinery before pointing at Postgres.
 */
export class MemorySharedBackend implements SharedStateBackend {
  readonly describe = 'memory';
  private readonly intents = new Map<string, { intent: Intent; uses: number; usedPaise: number }>();
  private readonly reservations = new Map<string, { verdict: unknown; settled: boolean; intentId: string; approvalIds: readonly string[]; amountPaise: number; sourceKeyId: string }>();
  private control: SharedControlState = { gen: 0 };
  /** Test hook: pretend a call failed — fail-closed semantics get exercised. */
  failNext = false;

  async putIntent(intent: Intent): Promise<void> {
    if (this.failNext) throw new Error('backend down');
    const cur = this.intents.get(intent.intentId);
    if (cur !== undefined) {
      if (cur.intent.signature !== intent.signature) throw new Error(`intent '${intent.intentId}' conflicts with the registered copy`);
      return;
    }
    this.intents.set(intent.intentId, { intent, uses: 0, usedPaise: 0 });
  }

  async getIntent(intentId: string): Promise<Intent | undefined> {
    if (this.failNext) throw new Error('backend down');
    return this.intents.get(intentId)?.intent;
  }

  async commit(c: ReservationCommit): Promise<CommitResult> {
    if (this.failNext) throw new Error('backend down');
    if (c.controlGen !== this.control.gen) return { conflict: 'control', gen: this.control.gen };
    const held = this.reservations.get(c.payoutId);
    if (held !== undefined) return { conflict: 'payoutId', verdict: held.verdict };
    for (const i of c.intents) {
      const cur = this.intents.get(i.intentId);
      if (cur === undefined) this.intents.set(i.intentId, { intent: i, uses: 0, usedPaise: 0 });
      else if (cur.intent.signature !== i.signature) return { conflict: 'uses', intentId: i.intentId };
    }
    for (const id of [c.intentId, ...c.approvalIds]) {
      const cur = this.intents.get(id);
      if (cur === undefined) return { conflict: 'uses', intentId: id };
      if (cur.uses >= cur.intent.maxUses || cur.intent.maxAmountPaise - cur.usedPaise < c.amountPaise) {
        return { conflict: 'uses', intentId: id, uses: cur.uses, usedPaise: cur.usedPaise };
      }
    }
    const counters: Record<string, { uses: number; usedPaise: number }> = {};
    for (const id of [c.intentId, ...c.approvalIds]) {
      const cur = this.intents.get(id)!;
      cur.uses += 1;
      cur.usedPaise += c.amountPaise;
      counters[id] = { uses: cur.uses, usedPaise: cur.usedPaise };
    }
    this.reservations.set(c.payoutId, { verdict: c.verdict, settled: false, intentId: c.intentId, approvalIds: c.approvalIds, amountPaise: c.amountPaise, sourceKeyId: c.sourceKeyId });
    return { committed: true, gen: this.control.gen, counters };
  }

  async intentState(intentId: string): Promise<{ uses: number; usedPaise: number } | undefined> {
    if (this.failNext) throw new Error('backend down');
    const cur = this.intents.get(intentId);
    return cur === undefined ? undefined : { uses: cur.uses, usedPaise: cur.usedPaise };
  }

  async releaseReservation(payoutId: string, sourceKeyId: string): Promise<boolean> {
    if (this.failNext) throw new Error('backend down');
    const r = this.reservations.get(payoutId);
    if (r === undefined || r.settled) return false;
    if (r.sourceKeyId !== '' && r.sourceKeyId !== sourceKeyId) return false;
    for (const id of [r.intentId, ...r.approvalIds]) {
      const cur = this.intents.get(id);
      if (cur !== undefined) {
        cur.uses = Math.max(0, cur.uses - 1);
        cur.usedPaise = Math.max(0, cur.usedPaise - r.amountPaise);
      }
    }
    this.reservations.delete(payoutId);
    return true;
  }

  async settleReservation(payoutId: string, sourceKeyId: string): Promise<boolean> {
    if (this.failNext) throw new Error('backend down');
    const r = this.reservations.get(payoutId);
    if (r === undefined) return false;
    if (r.sourceKeyId !== '' && r.sourceKeyId !== sourceKeyId) return false;
    r.settled = true;
    return true;
  }

  async readControl(): Promise<SharedControlState> {
    if (this.failNext) throw new Error('backend down');
    return this.control;
  }

  async writeControl(mutate: (cur: SharedControlState) => SharedControlState): Promise<boolean> {
    if (this.failNext) throw new Error('backend down');
    this.control = { ...mutate(this.control), gen: this.control.gen + 1 };
    return true;
  }
}
