// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import pg from 'pg';
import type { CommitResult, Intent, ReservationCommit, SharedControlState, SharedStateBackend } from '@payrekha/core';

export interface PostgresSharedBackendOptions {
  /** e.g. postgres://payrekha@db:5432/payrekha. Ignored when `pool` is given. Never logged. */
  readonly connectionString?: string;
  readonly pool?: pg.Pool;
  /** Table prefix, created on first use → `${prefix}_intents|_reservations|_control`. Default `payrekha_sa`. */
  readonly tablePrefix?: string;
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

interface SharedControlRow {
  readonly highAlert?: { readonly since: number; readonly reason: string } | null;
  readonly mode?: SharedControlState['mode'];
  readonly modeByKind?: SharedControlState['modeByKind'];
  readonly revokedKeyIds?: readonly string[];
}

/**
 * The ADR 0004 authoritative backend on Postgres. Three tables:
 *
 * - `*_intents`      — every registered intent (immutable doc) + uses/used_paise
 * - `*_reservations` — payoutId → cited intents + stored verdict, the dedupe tombstone
 * - `*_control`      — one row: alert/mode/revocations + generation
 *
 * `commit` is the single linearizable point: one transaction that locks the
 * control row (so a revocation/HIGH_ALERT can never slip in mid-commit),
 * inserts the reservation `ON CONFLICT DO NOTHING`, and conditionally bumps
 * every cited intent's counters. Any failed step rolls the whole thing back —
 * the gateway unbinds locally and re-evaluates with fresh facts.
 *
 * The gateway drives the flow; this class is deliberately dumb SQL.
 */
export class PostgresSharedBackend implements SharedStateBackend {
  readonly describe: string;
  private readonly pool: pg.Pool;
  private readonly ownsPool: boolean;
  private readonly intents: string;
  private readonly reservations: string;
  private readonly control: string;
  private ready: Promise<void> | undefined;

  constructor(o: PostgresSharedBackendOptions) {
    const prefix = o.tablePrefix ?? 'payrekha_sa';
    if (!IDENT.test(prefix)) throw new Error(`invalid table prefix: ${prefix}`);
    if (o.pool === undefined && o.connectionString === undefined) throw new Error('PostgresSharedBackend needs connectionString or pool');
    this.intents = `${prefix}_intents`;
    this.reservations = `${prefix}_reservations`;
    this.control = `${prefix}_control`;
    this.pool = o.pool ?? new pg.Pool({ connectionString: o.connectionString, max: 4 });
    this.ownsPool = o.pool === undefined;
    this.describe = `postgres:${prefix}`;
  }

  private init(): Promise<void> {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS ${this.intents} (
           intent_id text PRIMARY KEY,
           intent jsonb NOT NULL,
           uses bigint NOT NULL DEFAULT 0,
           used_paise bigint NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS ${this.reservations} (
           payout_id text PRIMARY KEY,
           source_key_id text NOT NULL DEFAULT '',
           intent_id text NOT NULL,
           approval_ids jsonb NOT NULL DEFAULT '[]',
           amount_paise bigint NOT NULL,
           verdict jsonb NOT NULL,
           settled boolean NOT NULL DEFAULT false,
           created_at timestamptz NOT NULL DEFAULT now()
         );
         CREATE TABLE IF NOT EXISTS ${this.control} (
           id smallint PRIMARY KEY CHECK (id = 1),
           gen bigint NOT NULL DEFAULT 0,
           state jsonb NOT NULL DEFAULT '{}',
           updated_at timestamptz NOT NULL DEFAULT now()
         );
         INSERT INTO ${this.control} (id, gen, state) VALUES (1, 0, '{}') ON CONFLICT (id) DO NOTHING;`,
      )
      .then(
        () => undefined,
        (e: unknown) => {
          this.ready = undefined;
          throw e;
        },
      );
    return this.ready;
  }

  async putIntent(intent: Intent): Promise<void> {
    await this.init();
    const r = await this.pool.query(`INSERT INTO ${this.intents} (intent_id, intent) VALUES ($1, $2::jsonb) ON CONFLICT (intent_id) DO NOTHING RETURNING intent_id`, [
      intent.intentId,
      JSON.stringify(intent),
    ]);
    if (r.rowCount === 0) {
      const ex = await this.pool.query<{ intent: Intent }>(`SELECT intent FROM ${this.intents} WHERE intent_id = $1`, [intent.intentId]);
      if (ex.rows[0] === undefined || ex.rows[0].intent.signature !== intent.signature) {
        throw new Error(`intent '${intent.intentId}' conflicts with the registered copy`);
      }
    }
  }

  async getIntent(intentId: string): Promise<Intent | undefined> {
    await this.init();
    const r = await this.pool.query<{ intent: Intent }>(`SELECT intent FROM ${this.intents} WHERE intent_id = $1`, [intentId]);
    return r.rows[0]?.intent;
  }

  async commit(c: ReservationCommit): Promise<CommitResult> {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the control row for the transaction: a revocation or HIGH_ALERT
      // landing mid-commit is impossible — it queues behind us instead.
      const ctl = await client.query<{ gen: string }>(`SELECT gen FROM ${this.control} WHERE id = 1 FOR UPDATE`);
      const gen = Number(ctl.rows[0]?.gen ?? 0);
      if (gen !== c.controlGen) {
        await client.query('ROLLBACK');
        return { conflict: 'control', gen };
      }
      const ins = await client.query(
        `INSERT INTO ${this.reservations} (payout_id, source_key_id, intent_id, approval_ids, amount_paise, verdict)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb) ON CONFLICT (payout_id) DO NOTHING RETURNING payout_id`,
        [c.payoutId, c.sourceKeyId, c.intentId, JSON.stringify(c.approvalIds), c.amountPaise, JSON.stringify(c.verdict)],
      );
      if (ins.rowCount === 0) {
        const ex = await client.query<{ verdict: unknown }>(`SELECT verdict FROM ${this.reservations} WHERE payout_id = $1`, [c.payoutId]);
        await client.query('ROLLBACK');
        return { conflict: 'payoutId', verdict: ex.rows[0]?.verdict };
      }
      const counters: Record<string, { uses: number; usedPaise: number }> = {};
      for (const i of c.intents) {
        await client.query(`INSERT INTO ${this.intents} (intent_id, intent) VALUES ($1, $2::jsonb) ON CONFLICT (intent_id) DO NOTHING`, [i.intentId, JSON.stringify(i)]);
        const u = await client.query<{ intent_id: string; uses: string; used_paise: string }>(
          `UPDATE ${this.intents} SET uses = uses + 1, used_paise = used_paise + $2
           WHERE intent_id = $1 AND uses < (intent->>'maxUses')::bigint AND (intent->>'maxAmountPaise')::bigint - used_paise >= $2
           RETURNING uses, used_paise`,
          [i.intentId, c.amountPaise],
        );
        const row = u.rows[0];
        if (row === undefined) {
          const st = await client.query<{ uses: string; used_paise: string }>(`SELECT uses, used_paise FROM ${this.intents} WHERE intent_id = $1`, [i.intentId]);
          await client.query('ROLLBACK');
          return {
            conflict: 'uses',
            intentId: i.intentId,
            uses: st.rows[0] === undefined ? undefined : Number(st.rows[0].uses),
            usedPaise: st.rows[0] === undefined ? undefined : Number(st.rows[0].used_paise),
          };
        }
        counters[i.intentId] = { uses: Number(row.uses), usedPaise: Number(row.used_paise) };
      }
      await client.query('COMMIT');
      return { committed: true, gen, counters };
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // the client may already be dead; the original error is what matters
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async intentState(intentId: string): Promise<{ uses: number; usedPaise: number } | undefined> {
    await this.init();
    const r = await this.pool.query<{ uses: string; used_paise: string }>(`SELECT uses, used_paise FROM ${this.intents} WHERE intent_id = $1`, [intentId]);
    const row = r.rows[0];
    return row === undefined ? undefined : { uses: Number(row.uses), usedPaise: Number(row.used_paise) };
  }

  async releaseReservation(payoutId: string, sourceKeyId: string): Promise<boolean> {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query<{ intent_id: string; approval_ids: string[]; amount_paise: string }>(
        `DELETE FROM ${this.reservations} WHERE payout_id = $1 AND settled = false AND (source_key_id = '' OR source_key_id = $2) RETURNING intent_id, approval_ids, amount_paise`,
        [payoutId, sourceKeyId],
      );
      const row = r.rows[0];
      if (row === undefined) {
        await client.query('ROLLBACK');
        return false;
      }
      const amount = Number(row.amount_paise);
      for (const id of [row.intent_id, ...row.approval_ids]) {
        await client.query(`UPDATE ${this.intents} SET uses = GREATEST(0, uses - 1), used_paise = GREATEST(0, used_paise - $2) WHERE intent_id = $1`, [id, amount]);
      }
      await client.query('COMMIT');
      return true;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // client already dead
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async settleReservation(payoutId: string, sourceKeyId: string): Promise<boolean> {
    await this.init();
    const r = await this.pool.query(`UPDATE ${this.reservations} SET settled = true WHERE payout_id = $1 AND settled = false AND (source_key_id = '' OR source_key_id = $2)`, [payoutId, sourceKeyId]);
    return (r.rowCount ?? 0) > 0;
  }

  async readControl(): Promise<SharedControlState> {
    await this.init();
    const r = await this.pool.query<{ gen: string; state: SharedControlRow }>(`SELECT gen, state FROM ${this.control} WHERE id = 1`);
    const row = r.rows[0];
    return { gen: Number(row?.gen ?? 0), ...row?.state };
  }

  async writeControl(mutate: (cur: SharedControlState) => SharedControlState): Promise<boolean> {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query<{ gen: string; state: SharedControlRow }>(`SELECT gen, state FROM ${this.control} WHERE id = 1 FOR UPDATE`);
      const row = cur.rows[0];
      const next = mutate({ gen: Number(row?.gen ?? 0), ...row?.state });
      const state: Record<string, unknown> = { ...next };
      delete state['gen'];
      await client.query(`UPDATE ${this.control} SET gen = gen + 1, state = $1::jsonb, updated_at = now() WHERE id = 1`, [JSON.stringify(state)]);
      await client.query('COMMIT');
      return true;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // client already dead
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async importIntent(rec: { intent: Intent; uses: number; usedPaise: number }): Promise<void> {
    await this.init();
    // GREATEST-merge: a replica that already committed holds higher counters —
    // the import must never walk truth backwards.
    await this.pool.query(
      `INSERT INTO ${this.intents} (intent_id, intent, uses, used_paise) VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (intent_id) DO UPDATE SET uses = GREATEST(${this.intents}.uses, EXCLUDED.uses), used_paise = GREATEST(${this.intents}.used_paise, EXCLUDED.used_paise)`,
      [rec.intent.intentId, JSON.stringify(rec.intent), rec.uses, rec.usedPaise],
    );
  }

  async importReservation(r: { payoutId: string; sourceKeyId: string; intentId: string; approvalIds: readonly string[]; amountPaise: number; verdict: unknown; settled: boolean }): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO ${this.reservations} (payout_id, source_key_id, intent_id, approval_ids, amount_paise, verdict, settled) VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7) ON CONFLICT (payout_id) DO NOTHING`,
      [r.payoutId, r.sourceKeyId, r.intentId, JSON.stringify(r.approvalIds), r.amountPaise, JSON.stringify(r.verdict), r.settled],
    );
  }

  async purgeReservations(olderThanMs: number): Promise<number> {
    await this.init();
    // Store clock — replicas skew, `now()` is the one time everyone agrees on.
    const r = await this.pool.query(`DELETE FROM ${this.reservations} WHERE settled = true AND created_at < now() - ($1::bigint * interval '1 millisecond')`, [olderThanMs]);
    return r.rowCount ?? 0;
  }

  async reservationStats(): Promise<{ pending: number; settled: number }> {
    await this.init();
    const r = await this.pool.query<{ pending: string; settled: string }>(`SELECT count(*) FILTER (WHERE settled = false) AS pending, count(*) FILTER (WHERE settled = true) AS settled FROM ${this.reservations}`);
    const row = r.rows[0];
    return { pending: Number(row?.pending ?? 0), settled: Number(row?.settled ?? 0) };
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}
