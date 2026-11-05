// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { createWriteStream, type WriteStream } from 'node:fs';
import type { PayoutRequest, PayoutVerdict } from '@payrekha/core';

/** One decision-log line. Hashed refs only — never a raw account, VPA or mobile. */
export interface DecisionRecord {
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

export function decisionRecord(v: PayoutVerdict, p: Partial<PayoutRequest> | undefined, requestId: string, via: DecisionRecord['via'], nowMs: number): DecisionRecord {
  const safe = (x: unknown) => (typeof x === 'string' && x.startsWith('hb1_') ? x : undefined);
  const r: Record<string, unknown> = {
    ts: new Date(nowMs).toISOString(),
    requestId,
    decisionId: v.decisionId,
    payoutId: v.payoutId,
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
    for (const k of ['intentId', 'sourceKeyId', 'origin', 'merchantId'] as const) if (typeof p[k] === 'string') r[k] = (p[k] as string).slice(0, 128);
  }
  return r as unknown as DecisionRecord;
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
  ];
  const e = ext
    .filter((x): x is [string, string | number] => x[1] !== undefined && x[1] !== '')
    .map(([k, v]) => `${k}=${cefExt(String(v))}`)
    .join(' ');
  return `CEF:0|People of Product|Payrekha|${cefHeader(version)}|${cefHeader(sig)}|${cefHeader(name)}|${sev}|${e}`;
}

export interface DecisionLog {
  write(r: DecisionRecord): void;
  close(): Promise<void>;
}

/** Append-only JSONL (default) or CEF. Writes are buffered by the stream; never awaited on the verdict path. */
export function fileDecisionLog(path: string, format: 'jsonl' | 'cef' = 'jsonl'): DecisionLog {
  const s: WriteStream = createWriteStream(path, { flags: 'a', mode: 0o600 });
  s.on('error', () => {
    /* counted by the caller via metrics; never crash the verdict path */
  });
  return {
    write: (r) => void s.write((format === 'cef' ? toCef(r) : JSON.stringify(r)) + '\n'),
    close: () => new Promise((res) => s.end(res)),
  };
}

export function memoryDecisionLog(): DecisionLog & { readonly lines: DecisionRecord[] } {
  const lines: DecisionRecord[] = [];
  return { lines, write: (r) => void lines.push(r), close: async () => undefined };
}
