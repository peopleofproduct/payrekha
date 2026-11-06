// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import pg from 'pg';
import { signSnapshot, verifyAndUnwrap, type FirewallSnapshot, type Payrekha, type StateStore } from '@payrekha/core';

export interface PostgresStateStoreOptions {
  /** e.g. postgres://payrekha@db:5432/payrekha. Ignored when `pool` is given. Never logged. */
  readonly connectionString?: string;
  readonly pool?: pg.Pool;
  /** Table name, created on first use. Default `payrekha_state`. */
  readonly table?: string;
  /** Snapshot row name; one per firewall deployment. Default `default`. */
  readonly name?: string;
  /** HMAC key for snapshot integrity (`PAYREKHA_STATE_KEY`). Once set, unsigned rows are refused. */
  readonly hmacKey?: string;
  /** Retiring keys that still verify during a rotation window (`PAYREKHA_STATE_KEY_PREVIOUS`). */
  readonly previousKeys?: readonly string[];
}

/** Another instance wrote the snapshot since we last read it. Two writers means split brain: stop and fail closed. */
export class StaleStateError extends Error {
  override readonly name = 'StaleStateError';
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Postgres state store. One row per deployment holds the full firewall
 * snapshot (hashed refs only) as JSONB plus a version counter. Every save
 * is a compare-and-set on that version, so a second active writer is
 * detected (StaleStateError) instead of silently overwriting HIGH_ALERT.
 *
 * Topology: one active gateway per `name`, any number of standbys that
 * `load` on promotion. It is not a shared state store for active-active
 * replicas; velocity and probe windows live in memory between saves.
 */
export class PostgresStateStore implements StateStore {
  readonly describe: string;
  private readonly pool: pg.Pool;
  private readonly ownsPool: boolean;
  private readonly table: string;
  private readonly name: string;
  private readonly hmacKey: string | undefined;
  private readonly previousKeys: readonly string[];
  /** null until the first load: we have not seen the row yet. 0 = row did not exist. */
  private version: number | null = null;
  private ready: Promise<void> | undefined;

  constructor(o: PostgresStateStoreOptions) {
    const table = o.table ?? 'payrekha_state';
    if (!IDENT.test(table)) throw new Error(`invalid table name: ${table}`);
    if (o.pool === undefined && o.connectionString === undefined) throw new Error('PostgresStateStore needs connectionString or pool');
    this.table = table;
    this.name = o.name ?? 'default';
    this.hmacKey = o.hmacKey;
    this.previousKeys = o.previousKeys ?? [];
    this.pool = o.pool ?? new pg.Pool({ connectionString: o.connectionString, max: 2 });
    this.ownsPool = o.pool === undefined;
    this.describe = `postgres:${table}/${this.name}`;
  }

  private init(): Promise<void> {
    // A transient failure must not be cached: the gateway retries loads, and
    // a rejected `ready` promise stored forever would keep the store broken
    // until restart even though Postgres recovered.
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS ${this.table} (
           name text PRIMARY KEY,
           version bigint NOT NULL,
           snapshot jsonb NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now()
         )`,
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

  async load(fw: Payrekha): Promise<boolean> {
    await this.init();
    const r = await this.pool.query<{ version: string; snapshot: FirewallSnapshot }>(`SELECT version, snapshot FROM ${this.table} WHERE name = $1`, [this.name]);
    const row = r.rows[0];
    if (row === undefined) {
      this.version = 0;
      return false;
    }
    fw.restoreState(verifyAndUnwrap(row.snapshot, this.hmacKey, this.previousKeys));
    this.version = Number(row.version);
    return true;
  }

  async save(fw: Payrekha): Promise<void> {
    await this.init();
    if (this.version === null) throw new StaleStateError('save before load: refusing to overwrite a snapshot we have not read');
    const snap = JSON.stringify(signSnapshot(fw.exportState(), this.hmacKey));
    const r =
      this.version === 0
        ? await this.pool.query<{ version: string }>(
            `INSERT INTO ${this.table} (name, version, snapshot) VALUES ($1, 1, $2::jsonb) ON CONFLICT (name) DO NOTHING RETURNING version`,
            [this.name, snap],
          )
        : await this.pool.query<{ version: string }>(
            `UPDATE ${this.table} SET snapshot = $2::jsonb, version = version + 1, updated_at = now() WHERE name = $1 AND version = $3 RETURNING version`,
            [this.name, snap, this.version],
          );
    const row = r.rows[0];
    if (row === undefined) throw new StaleStateError(`snapshot ${this.describe} was written by another instance`);
    this.version = Number(row.version);
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}
