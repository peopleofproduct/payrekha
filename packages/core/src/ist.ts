// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

/** India has one zone and no DST, so a fixed +05:30 offset is exact. */
export const IST_OFFSET_MS = 5.5 * 3_600_000;

export interface IstParts {
  /** YYYY-MM-DD in Asia/Kolkata. */
  readonly date: string;
  /** 0 = Sunday … 6 = Saturday, in Asia/Kolkata. */
  readonly dayOfWeek: number;
  /** 0–23 in Asia/Kolkata. */
  readonly hour: number;
  readonly minute: number;
}

/** Calendar parts of an epoch-ms instant in IST. Pure arithmetic — no Intl, no host TZ. */
export function istParts(epochMs: number): IstParts {
  const d = new Date(epochMs + IST_OFFSET_MS);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { date, dayOfWeek: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** Epoch ms for a wall-clock time in IST. `month` is 1-based. */
export function istToEpochMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute, second) - IST_OFFSET_MS;
}

/** "2026-11-08 14:05:09 IST" — for logs and reports. */
export function formatIst(epochMs: number): string {
  const d = new Date(epochMs + IST_OFFSET_MS);
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} IST`;
}
