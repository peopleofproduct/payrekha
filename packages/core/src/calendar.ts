// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { istParts } from './ist.js';

export interface HolidayEntry {
  /** YYYY-MM-DD in IST. */
  readonly date: string;
  readonly name: string;
}

export interface CalendarConfig {
  readonly holidays?: readonly HolidayEntry[];
  /** IST days of week treated as low-coverage (0 = Sunday). Default [0, 6]. */
  readonly weekendDays?: readonly number[];
  /** IST hour range treated as low-coverage, e.g. {from: 23, to: 6}. `null` disables. */
  readonly lowCoverageHours?: { readonly from: number; readonly to: number } | null;
}

export interface CalendarWindow {
  readonly kind: 'holiday' | 'weekend' | 'night';
  readonly label: string;
  readonly istDate: string;
  readonly istHour: number;
}

/**
 * Low-coverage windows in Asia/Kolkata: listed holidays, weekends and odd
 * hours — when SOC staffing is thin and CRAFTY FALCON-style actors strike.
 */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export class Calendar {
  private readonly holidays: Map<string, string>;
  private readonly weekendDays: ReadonlySet<number>;
  private readonly hours: { from: number; to: number } | null;

  constructor(cfg: CalendarConfig = {}) {
    this.holidays = new Map((cfg.holidays ?? []).map((h) => [h.date, h.name]));
    this.weekendDays = new Set(cfg.weekendDays ?? [0, 6]);
    this.hours = cfg.lowCoverageHours === undefined ? { from: 23, to: 6 } : cfg.lowCoverageHours;
  }

  window(epochMs: number): CalendarWindow | null {
    const p = istParts(epochMs);
    const holiday = this.holidays.get(p.date);
    if (holiday !== undefined) return { kind: 'holiday', label: holiday, istDate: p.date, istHour: p.hour };
    if (this.weekendDays.has(p.dayOfWeek)) return { kind: 'weekend', label: DAY_NAMES[p.dayOfWeek]!, istDate: p.date, istHour: p.hour };
    if (this.hours !== null) {
      const { from, to } = this.hours;
      const inNight = from > to ? p.hour >= from || p.hour < to : p.hour >= from && p.hour < to;
      if (inNight) return { kind: 'night', label: `${String(from).padStart(2, '0')}:00–${String(to).padStart(2, '0')}:00 IST`, istDate: p.date, istHour: p.hour };
    }
    return null;
  }
}
