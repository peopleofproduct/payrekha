// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import type { RuleHit, Verdict } from '@payrekha/core';

export const hit = (rule: string, verdict: Verdict, reason: string, evidence: RuleHit['evidence'], raiseAlert?: 'HIGH_ALERT'): RuleHit =>
  raiseAlert !== undefined ? { rule, verdict, reason, evidence, raiseAlert } : { rule, verdict, reason, evidence };

/** "₹4,99,999" — Indian digit grouping, paise dropped when zero. */
export const rupees = (paise: number): string => {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return `₹${r.toLocaleString('en-IN')}${p !== 0 ? `.${String(p).padStart(2, '0')}` : ''}`;
};
