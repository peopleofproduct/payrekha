// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { FirewallSnapshot, Payrekha } from './firewall.js';

/**
 * Where the firewall snapshot lives between restarts. `load` returns false
 * when there is no snapshot yet and throws on a corrupt one (callers fail
 * closed). Implementations may be sync (file) or async (Postgres).
 */
export interface StateStore {
  /** Human-readable location for logs. Must not contain credentials. */
  readonly describe: string;
  save(fw: Payrekha): void | Promise<void>;
  load(fw: Payrekha): boolean | Promise<boolean>;
  close?(): void | Promise<void>;
}

/**
 * File store: a JSON snapshot of the whole firewall (intents, ledgers,
 * canaries, rule state, HIGH_ALERT). Written atomically (tmp + rename) so
 * a crash mid-write never leaves a half file. Contains hashed refs only.
 */
export class FileStateStore implements StateStore {
  constructor(readonly path: string) {}

  get describe(): string {
    return `file:${this.path}`;
  }

  save(fw: Payrekha): void {
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(fw.exportState()), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  /** Returns false when there is no snapshot yet. Throws on a corrupt one. */
  load(fw: Payrekha): boolean {
    if (!existsSync(this.path)) return false;
    const snap = JSON.parse(readFileSync(this.path, 'utf8')) as FirewallSnapshot;
    fw.restoreState(snap);
    return true;
  }
}
