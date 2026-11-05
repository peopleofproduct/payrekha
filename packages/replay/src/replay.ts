// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { createHash, randomBytes } from 'node:crypto';
import { generateIssuerKeyPair, hashBeneficiary, looksLikeRawIdentifier, Payrekha, signIntent, type FirewallConfig, type IntentKind, type PayoutRequest, type PayoutVerdict, type RuleHit } from '@payrekha/core';
import { payrekhaRules, type RulesConfig } from '@payrekha/rules';

/** Our field → your column. Every key optional; defaults are the snake_case names below. */
export type ColumnMap = Partial<Record<keyof typeof DEFAULT_COLUMNS, string>>;

export const DEFAULT_COLUMNS = {
  payoutId: 'payout_id',
  timestamp: 'timestamp',
  kind: 'kind',
  amountPaise: 'amount_paise',
  amountRupees: 'amount_rupees',
  beneficiaryRef: 'beneficiary_ref',
  account: 'beneficiary_account',
  ifsc: 'beneficiary_ifsc',
  vpa: 'beneficiary_vpa',
  channel: 'channel',
  sourceKeyId: 'source_key_id',
  origin: 'origin',
  merchantId: 'merchant_id',
  intentId: 'intent_id',
  event: 'event',
  // intents file
  maxAmountPaise: 'max_amount_paise',
  subjectRef: 'subject_ref',
  maxUses: 'max_uses',
  notBefore: 'not_before',
  expiresAt: 'expires_at',
} as const;

export interface ReplayOptions {
  readonly payouts: readonly Record<string, unknown>[];
  /** Omit → intent-less mode: intent rules are skipped, behaviour rules only. */
  readonly intents?: readonly Record<string, unknown>[];
  readonly map?: ColumnMap;
  readonly rules?: RulesConfig;
  readonly firewall?: FirewallConfig;
  /** Keyed-hash secret for raw ids in the export. Default: random per run (refs are not comparable across runs). */
  readonly hashKey?: string;
  /**
   * HIGH_ALERT persists until a human resets it. In a replay nobody is there,
   * so it is reset after this many simulated hours (default 24) and every
   * episode is listed in the report. 0 = never reset.
   */
  readonly alertResetHours?: number;
}

export interface FlaggedPayout {
  readonly payoutId: string;
  readonly atMs: number;
  readonly kind: string;
  readonly amountPaise: number;
  readonly beneficiaryRef: string;
  readonly sourceKeyId: string;
  readonly verdict: 'REVIEW' | 'BLOCK';
  readonly degraded: boolean;
  readonly hits: readonly RuleHit[];
}

export interface Chain {
  readonly key: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly amountPaise: number;
  readonly worst: 'REVIEW' | 'BLOCK';
  readonly rules: readonly string[];
  readonly steps: readonly FlaggedPayout[];
}

export interface ReplayReport {
  readonly generatedAt: string;
  readonly intentLess: boolean;
  readonly inputRows: number;
  readonly skippedRows: { readonly row: number; readonly reason: string }[];
  readonly totals: {
    readonly payouts: number;
    readonly amountPaise: number;
    readonly allow: { count: number; amountPaise: number };
    readonly review: { count: number; amountPaise: number };
    readonly block: { count: number; amountPaise: number };
    readonly degraded: number;
  };
  readonly topRules: readonly { rule: string; hits: number; amountPaise: number }[];
  readonly chains: readonly Chain[];
  readonly falsePositiveReview: readonly FlaggedPayout[];
  readonly flagged: readonly FlaggedPayout[];
  readonly alertEpisodes: readonly { readonly startMs: number; readonly endMs: number | null; readonly trigger: string }[];
  readonly p99Micros: number;
}

const KINDS = new Set(['LOAN_DISBURSAL', 'PA_SETTLEMENT', 'REFUND', 'VDA_WITHDRAWAL', 'VENDOR_PAYOUT', 'VERIFICATION']);

export function parseTime(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
  if (typeof v !== 'string' || v === '') return undefined;
  if (/^\d{12,}$/.test(v)) return Number(v);
  // Bare "YYYY-MM-DD HH:MM[:SS]" is IST — that is how Indian ledgers export.
  const bare = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(v);
  const t = Date.parse(bare ? `${v.replace(' ', 'T')}${v.length === 16 ? ':00' : ''}+05:30` : v);
  return Number.isNaN(t) ? undefined : t;
}

function paise(row: Record<string, unknown>, c: Record<string, string>): number | undefined {
  const p = row[c['amountPaise']!];
  if (p !== undefined && p !== '') {
    const n = typeof p === 'number' ? p : /^\d+$/.test(String(p)) ? Number(p) : NaN;
    return Number.isSafeInteger(n) ? n : undefined;
  }
  const r = row[c['amountRupees']!];
  if (r === undefined || r === '') return undefined;
  // Rupees with at most two decimals, parsed as a string — never through a float.
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(r).replace(/,/g, ''));
  return m === null ? undefined : Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function runReplay(o: ReplayOptions): ReplayReport {
  const c: Record<string, string> = { ...DEFAULT_COLUMNS, ...o.map };
  const hk = o.hashKey ?? randomBytes(32).toString('hex');
  const intentLess = o.intents === undefined;
  const ref = (row: Record<string, unknown>): string | undefined => {
    const given = row[c['beneficiaryRef']!];
    if (typeof given === 'string' && given.startsWith('hb1_')) return given;
    const s = (k: string) => (row[c[k]!] === undefined || row[c[k]!] === '' ? undefined : String(row[c[k]!]));
    const acc = s('account');
    const ifsc = s('ifsc');
    const vpa = s('vpa');
    try {
      if (acc !== undefined && ifsc !== undefined) return hashBeneficiary({ account: acc, ifsc }, hk);
      if (vpa !== undefined) return hashBeneficiary({ vpa }, hk);
      if (typeof given === 'string' && given !== '' && !looksLikeRawIdentifier(given)) return hashBeneficiary({ address: given, network: 'opaque' }, hk);
    } catch {
      return undefined;
    }
    return undefined;
  };

  const set = payrekhaRules(o.rules ?? {});
  const rules = intentLess ? set.rules.filter((r) => r.name !== 'intent') : set.rules;
  const issuer = generateIssuerKeyPair();
  const allKinds = [...KINDS] as IntentKind[];
  const admin = randomBytes(24).toString('hex');
  const cfg: FirewallConfig = {
    ...o.firewall,
    adminTokenSha256: createHash('sha256').update(admin).digest('hex'),
    mode: 'shadow',
    ...(intentLess ? { requireIntent: Object.fromEntries(allKinds.map((k) => [k, false])) } : {}),
  };
  let clock = 0;
  const fw = new Payrekha(rules, { config: cfg, keys: [{ keyId: 'replay', issuer: 'replay', alg: 'ed25519', publicKey: issuer.publicKey, kinds: allKinds }], now: () => clock });

  // Intents from an LOS export are unsigned: sign them with a throwaway key — "as if these had been signed intents".
  for (const row of o.intents ?? []) {
    const kind = String(row[c['kind']!] ?? '');
    const b = ref(row);
    const nb = parseTime(row[c['notBefore']!]);
    const ex = parseTime(row[c['expiresAt']!]);
    const max = Number(row[c['maxAmountPaise']!]);
    const id = String(row[c['intentId']!] ?? '');
    if (!KINDS.has(kind) || b === undefined || nb === undefined || ex === undefined || !Number.isSafeInteger(max) || id === '') continue;
    const sub = row[c['subjectRef']!];
    const uses = Number(row[c['maxUses']!] || 1);
    clock = nb;
    fw.registerIntent(
      signIntent({ intentId: id, kind: kind as IntentKind, maxAmountPaise: max, beneficiaryRef: b, maxUses: Number.isSafeInteger(uses) ? uses : 1, notBeforeMs: nb, expiresAtMs: ex, issuer: 'replay', keyId: 'replay', ...(sub ? { subjectRef: String(sub) } : {}) }, { alg: 'ed25519', privateKey: issuer.privateKey }),
      nb,
    );
  }

  const skipped: { row: number; reason: string }[] = [];
  const events: { at: number; i: number; row: Record<string, unknown> }[] = [];
  o.payouts.forEach((row, i) => {
    const at = parseTime(row[c['timestamp']!]);
    if (at === undefined) skipped.push({ row: i + 2, reason: 'unparseable timestamp' });
    else events.push({ at, i, row });
  });
  events.sort((a, b) => a.at - b.at || a.i - b.i);

  const totals = { payouts: 0, amountPaise: 0, allow: { count: 0, amountPaise: 0 }, review: { count: 0, amountPaise: 0 }, block: { count: 0, amountPaise: 0 }, degraded: 0 };
  const ruleAgg = new Map<string, { hits: number; amountPaise: number }>();
  const flagged: FlaggedPayout[] = [];
  const lat: number[] = [];
  const episodes: { startMs: number; endMs: number | null; trigger: string }[] = [];
  const resetMs = (o.alertResetHours ?? 24) * 3_600_000;
  for (const { at, i, row } of events) {
    clock = at;
    const open = episodes.at(-1);
    if (open !== undefined && open.endMs === null && resetMs > 0 && at - open.startMs >= resetMs && fw.alertState === 'HIGH_ALERT') {
      fw.resetHighAlert({ actor: 'replay', reason: 'simulated operator reset', adminToken: admin });
      open.endMs = at;
    }
    const ev = String(row[c['event']!] ?? '');
    const b = ref(row);
    if (ev === 'account_changed') {
      const m = row[c['merchantId']!];
      if (typeof m === 'string' && m !== '' && b !== undefined) fw.noteMerchantAccountChange(m, b, at);
      continue;
    }
    const amount = paise(row, c);
    const p: Record<string, unknown> = {
      payoutId: String(row[c['payoutId']!] ?? `row-${i + 2}`),
      kind: String(row[c['kind']!] ?? ''),
      amountPaise: amount,
      beneficiaryRef: b,
      channel: String(row[c['channel']!] || 'IMPS'),
      sourceKeyId: String(row[c['sourceKeyId']!] || 'unknown'),
      origin: String(row[c['origin']!] || 'prod'),
      timestampMs: at,
    };
    for (const k of ['merchantId', 'intentId'] as const) {
      const v = row[c[k]!];
      if (v !== undefined && v !== '') p[k] = String(v);
    }
    const v: PayoutVerdict = fw.evaluate(p as unknown as PayoutRequest);
    fw.reportOutcome(v.payoutId, 'settled');
    if (fw.alertState === 'HIGH_ALERT' && (episodes.length === 0 || episodes.at(-1)!.endMs !== null))
      episodes.push({ startMs: at, endMs: null, trigger: v.hits.map((h) => h.rule).join(',') || 'burst' });
    lat.push(v.elapsedMicros);
    const amt = amount ?? 0;
    totals.payouts += 1;
    totals.amountPaise += amt;
    const bucket = v.verdict === 'ALLOW' ? totals.allow : v.verdict === 'REVIEW' ? totals.review : totals.block;
    bucket.count += 1;
    bucket.amountPaise += amt;
    if (v.degraded) totals.degraded += 1;
    for (const h of v.hits) {
      if (h.verdict === 'ALLOW') continue;
      const a = ruleAgg.get(h.rule) ?? { hits: 0, amountPaise: 0 };
      a.hits += 1;
      a.amountPaise += amt;
      ruleAgg.set(h.rule, a);
    }
    if (v.verdict !== 'ALLOW')
      flagged.push({ payoutId: v.payoutId, atMs: at, kind: String(p['kind']), amountPaise: amt, beneficiaryRef: b ?? '(missing)', sourceKeyId: String(p['sourceKeyId']), verdict: v.verdict, degraded: v.degraded, hits: v.hits.filter((h) => h.verdict !== 'ALLOW') });
  }
  lat.sort((a, b) => a - b);
  return {
    generatedAt: new Date().toISOString(),
    intentLess,
    inputRows: o.payouts.length,
    skippedRows: skipped,
    totals,
    topRules: [...ruleAgg].map(([rule, a]) => ({ rule, ...a })).sort((x, y) => y.hits - x.hits),
    chains: chains(flagged),
    falsePositiveReview: flagged.filter((f) => f.verdict === 'REVIEW' && f.hits.length === 1).sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 50),
    flagged,
    alertEpisodes: episodes,
    p99Micros: lat.length === 0 ? 0 : lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.99))]!,
  };
}

/** Group flagged payouts that share a beneficiary or source key within 24 h into a timeline. */
function chains(flagged: readonly FlaggedPayout[]): Chain[] {
  const DAY = 86_400_000;
  const groups: FlaggedPayout[][] = [];
  const open = new Map<string, FlaggedPayout[]>();
  for (const f of flagged) {
    const keys = [`ben:${f.beneficiaryRef}`, `src:${f.sourceKeyId}`];
    let g: FlaggedPayout[] | undefined;
    for (const k of keys) {
      const cand = open.get(k);
      // Same beneficiary within a day, or the same calling key within an hour.
      const gap = k.startsWith('ben:') ? DAY : DAY / 24;
      if (cand !== undefined && f.atMs - cand[cand.length - 1]!.atMs <= gap) {
        g = cand;
        break;
      }
    }
    if (g === undefined) {
      g = [];
      groups.push(g);
    }
    g.push(f);
    for (const k of keys) open.set(k, g);
  }
  return groups
    .filter((g) => g.length >= 2 || g.some((f) => f.verdict === 'BLOCK'))
    .map((g) => ({
      key: g[0]!.sourceKeyId,
      startMs: g[0]!.atMs,
      endMs: g[g.length - 1]!.atMs,
      amountPaise: g.reduce((a, f) => a + f.amountPaise, 0),
      worst: g.some((f) => f.verdict === 'BLOCK') ? ('BLOCK' as const) : ('REVIEW' as const),
      rules: [...new Set(g.flatMap((f) => f.hits.map((h) => h.rule)))],
      steps: g,
    }))
    .sort((a, b) => b.amountPaise - a.amountPaise);
}
