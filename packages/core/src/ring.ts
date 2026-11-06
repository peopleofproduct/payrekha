// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

/**
 * Fixed-capacity window of (timestamp, amount) pairs. Old entries are
 * overwritten, so memory per tracked key is constant. Sums are recomputed
 * over the live window on read — capacity is small (tens to hundreds),
 * which keeps this cheaper and simpler than incremental bookkeeping that
 * breaks on out-of-order timestamps.
 */
export class TimeRing {
  private readonly ts: Float64Array;
  private readonly amt: Float64Array;
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.ts = new Float64Array(capacity);
    this.amt = new Float64Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  push(tsMs: number, amount: number): void {
    this.ts[this.head] = tsMs;
    this.amt[this.head] = amount;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  /** Count and sum of entries with `fromMs < ts <= toMs`. */
  window(fromMs: number, toMs: number): { count: number; sum: number } {
    let count = 0;
    let sum = 0;
    for (let i = 0; i < this.count; i++) {
      const t = this.ts[i]!;
      if (t > fromMs && t <= toMs) {
        count += 1;
        sum += this.amt[i]!;
      }
    }
    return { count, sum };
  }

  /** Amounts in insertion order, oldest first. */
  values(): number[] {
    const out: number[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) out.push(this.amt[(start + i) % this.capacity]!);
    return out;
  }

  toJSON(): [number, number][] {
    const out: [number, number][] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const j = (start + i) % this.capacity;
      out.push([this.ts[j]!, this.amt[j]!]);
    }
    return out;
  }

  static from(capacity: number, rows: readonly (readonly [number, number])[]): TimeRing {
    const r = new TimeRing(capacity);
    for (const [t, a] of rows) r.push(t, a);
    return r;
  }
}
