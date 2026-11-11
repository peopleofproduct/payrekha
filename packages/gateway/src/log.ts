// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { createWriteStream, type WriteStream } from 'node:fs';
import type { AuditEntry, PayoutRequest, PayoutVerdict } from '@payrekha/core';

/** One decision-log line. Hashed refs only — never a raw account, VPA or mobile. */
export interface DecisionRecord {
  readonly type: 'decision';
  readonly ts: string;
  readonly requestId: string;
  readonly decisionId: string;
  readonly payoutId: string;
  readonly via: 'evaluate' | 'ext_authz';
  readonly kind?: string;
  readonly amountPaise?: number;
  readonly beneficiaryRef?: string;
  readonly intentId?: string;
  readonly sourceKeyId?: string;
  readonly origin?: string;
  readonly merchantId?: string;
  /** Edge-asserted source-network hint (peer IP / proxy headers). Untrusted evidence. */
  readonly sourceHint?: string;
  /** Caller's claimed timestamp when the gateway overrode it. Untrusted evidence. */
  readonly clientTimestampMs?: number;
  readonly mode: string;
  readonly alertState: string;
  readonly verdict: string;
  readonly effectiveAction: string;
  readonly degraded: boolean;
  readonly deduped: boolean;
  readonly rules: readonly string[];
  readonly hits: PayoutVerdict['hits'];
  readonly ruleErrors: readonly string[];
  readonly elapsedMicros: number;
}

export function decisionRecord(
  v: PayoutVerdict,
  p: Partial<PayoutRequest> | undefined,
  requestId: string,
  via: DecisionRecord['via'],
  nowMs: number,
): DecisionRecord {
  const safe = (x: unknown) => (typeof x === 'string' && x.startsWith('hb1_') ? x : undefined);
  const r: Record<string, unknown> = {
    type: 'decision',
    ts: new Date(nowMs).toISOString(),
    requestId,
    decisionId: v.decisionId,
    payoutId: v.payoutId.slice(0, 128),
    via,
    mode: v.mode,
    alertState: v.alertState,
    verdict: v.verdict,
    effectiveAction: v.effectiveAction,
    degraded: v.degraded,
    deduped: v.deduped,
    rules: v.hits.map((h) => h.rule),
    hits: v.hits,
    ruleErrors: v.ruleErrors.map((e) => e.rule),
    elapsedMicros: v.elapsedMicros,
  };
  if (p !== undefined && p !== null && typeof p === 'object') {
    if (typeof p.kind === 'string') r['kind'] = p.kind;
    if (Number.isSafeInteger(p.amountPaise)) r['amountPaise'] = p.amountPaise;
    // Only a hashed ref is ever logged; a raw-looking value is dropped.
    const b = safe(p.beneficiaryRef);
    if (b !== undefined) r['beneficiaryRef'] = b;
    for (const k of ['intentId', 'sourceKeyId', 'origin', 'merchantId', 'sourceHint'] as const)
      if (typeof p[k] === 'string') r[k] = (p[k] as string).slice(0, 128);
    if (Number.isSafeInteger(p.clientTimestampMs)) r['clientTimestampMs'] = p.clientTimestampMs;
  }
  return r as unknown as DecisionRecord;
}

/** An audit-trail line (mode changes, alert raises/resets, denied outcomes) for the same log. */
export interface AuditLogRecord extends Record<string, unknown> {
  readonly type: 'audit';
  readonly ts: string;
}
export function auditRecord(e: AuditEntry): AuditLogRecord {
  const { atMs, ...rest } = e;
  return { type: 'audit', ts: new Date(atMs).toISOString(), ...rest };
}

const cefHeader = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
const cefExt = (s: string) => s.replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/\r?\n/g, ' ');

/** ArcSight CEF:0 — for QRadar / ArcSight. Severity 9 BLOCK, 5 REVIEW, 1 ALLOW. */
export function toCef(r: DecisionRecord, version = '0.1.0'): string {
  const sev = r.verdict === 'BLOCK' ? 9 : r.verdict === 'REVIEW' ? 5 : 1;
  const sig = r.rules[0] ?? `verdict.${r.verdict.toLowerCase()}`;
  const name = r.hits[0]?.reason ?? r.verdict;
  const ext: [string, string | number | undefined][] = [
    ['rt', Date.parse(r.ts)],
    ['act', r.effectiveAction],
    ['outcome', r.verdict],
    ['externalId', r.decisionId],
    ['cs1Label', 'payoutId'],
    ['cs1', r.payoutId],
    ['cs2Label', 'rules'],
    ['cs2', r.rules.join(',')],
    ['cs3Label', 'mode'],
    ['cs3', r.mode],
    ['cs4Label', 'alertState'],
    ['cs4', r.alertState],
    ['cs5Label', 'kind'],
    ['cs5', r.kind],
    ['cs6Label', 'beneficiaryRef'],
    ['cs6', r.beneficiaryRef],
    ['cn1Label', 'amountPaise'],
    ['cn1', r.amountPaise],
    ['suser', r.sourceKeyId],
    // A bare-IP hint also fills CEF's native `src` field for SIEM correlation.
    ['src', r.sourceHint !== undefined && /^[0-9a-fA-F:.]{3,45}$/.test(r.sourceHint) ? r.sourceHint : undefined],
    ['cs7Label', 'sourceHint'],
    ['cs7', r.sourceHint],
  ];
  const e = ext
    .filter((x): x is [string, string | number] => x[1] !== undefined && x[1] !== '')
    .map(([k, v]) => `${k}=${cefExt(String(v))}`)
    .join(' ');
  return `CEF:0|People of Product|Payrekha|${cefHeader(version)}|${cefHeader(sig)}|${cefHeader(name)}|${sev}|${e}`;
}

export type LogRecord = DecisionRecord | AuditLogRecord;

export interface DecisionLog {
  write(r: LogRecord): void;
  close(): Promise<void>;
  /** Async stream failures observed so far — surfaced into metrics. */
  readonly errors?: number;
}

/**
 * Append-only JSONL (default) or CEF. Writes are buffered by the stream;
 * never awaited on the verdict path. Audit records stay JSON even under
 * `cef`: a CEF parser sees them as foreign lines rather than wrong fields.
 */
export function fileDecisionLog(path: string, format: 'jsonl' | 'cef' = 'jsonl', onError?: (e: unknown) => void): DecisionLog {
  const s: WriteStream = createWriteStream(path, { flags: 'a', mode: 0o600 });
  let errors = 0;
  s.on('error', (e) => {
    errors += 1;
    try {
      onError?.(e);
    } catch {
      /* the verdict path must never break on logging */
    }
  });
  return {
    write: (r) => void s.write((format === 'cef' && r.type === 'decision' ? toCef(r) : JSON.stringify(r)) + '\n'),
    close: () => new Promise((res) => s.end(res)),
    get errors() {
      return errors;
    },
  };
}

export function memoryDecisionLog(): DecisionLog & { readonly lines: LogRecord[] } {
  const lines: LogRecord[] = [];
  return { lines, write: (r) => void lines.push(r), close: async () => undefined };
}
