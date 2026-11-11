// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { createHash, randomBytes } from 'node:crypto';
import {
  generateIssuerKeyPair,
  hashBeneficiary,
  looksLikeRawIdentifier,
  Payrekha,
  signIntent,
  type FirewallConfig,
  type IntentKind,
  type IssuerKeyPair,
  type PayoutRequest,
  type PayoutVerdict,
  type RuleHit,
} from '@payrekha/core';
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
  /** m-of-n approvals (ADR 0003): comma-separated intent ids, e.g. `wd-4-ops,wd-4-risk`. */
  approvalIds: 'approval_ids',
  event: 'event',
  // intents file
  maxAmountPaise: 'max_amount_paise',
  subjectRef: 'subject_ref',
  maxUses: 'max_uses',
  notBefore: 'not_before',
  expiresAt: 'expires_at',
  /** intents file: who signed this row — for m-of-n approver issuers. */
  issuer: 'issuer',
  issuerKeyId: 'key_id',
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
  /**
   * Intent-less mode only: penny-drop accounting. Rows tagged VERIFICATION
   * mark their beneficiary as verified (the lender already proved the
   * account), which exempts later payouts to it from probe/cooling —
   * exactly as a signed VERIFICATION intent would.
   */
  readonly pennyDrop?: {
    readonly verificationRows: number;
    readonly verifiedBeneficiaries: number;
    readonly boundPayouts: number;
    readonly untaggedMicro: number;
    readonly tip?: string;
  };
  /**
   * Intent-less mode only: starting thresholds derived from this export's
   * own distribution — percentiles are illustrative, not a verdict on
   * your traffic. `config` is shaped like payrekha.json.
   */
  readonly suggested?: {
    readonly config: {
      readonly firewall: { readonly microPaise?: number };
      readonly rules: {
        readonly probe?: { readonly largePaise: number };
        readonly cooling?: { readonly minAmountPaise: number };
        readonly velocity?: { readonly perSourceKey: { readonly count: number; readonly sumPaise: number } };
      };
    };
    readonly percentiles: {
      readonly windowCountP95: number;
      readonly windowCountP99: number;
      readonly windowSumP95Paise: number;
      readonly windowSumP99Paise: number;
      readonly amountP75Paise: number;
      readonly nonMicroP25Paise?: number;
      readonly microP95Paise?: number;
    };
  };
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
      if (typeof given === 'string' && given !== '' && !looksLikeRawIdentifier(given))
        return hashBeneficiary({ address: given, network: 'opaque' }, hk);
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

  // Intents from an LOS export are unsigned: sign them with throwaway keys —
  // "as if these had been signed intents". An `issuer`/`key_id` column makes
  // the row belong to that issuer (its own throwaway keypair + keyring
  // entry), which is what m-of-n approval requirements verify against.
  const signers = new Map<string, { keyId: string; issuer: string; pair: IssuerKeyPair }>();
  signers.set('replay', { keyId: 'replay', issuer: 'replay', pair: issuer });
  const keyFor = (issuerName: string, keyId: string) => {
    const id = `${issuerName}/${keyId}`;
    let s = signers.get(id);
    if (s === undefined) {
      s = { keyId, issuer: issuerName, pair: generateIssuerKeyPair() };
      signers.set(id, s);
    }
    return s;
  };
  for (const row of o.intents ?? []) {
    const iss = String(row[c['issuer']!] ?? 'replay');
    const kid = String(row[c['issuerKeyId']!] ?? 'replay');
    keyFor(iss === '' ? 'replay' : iss, kid === '' ? 'replay' : kid);
  }
  const fw = new Payrekha(rules, {
    config: cfg,
    keys: [...signers.values()].map((s) => ({
      keyId: s.keyId,
      issuer: s.issuer,
      alg: 'ed25519' as const,
      publicKey: s.pair.publicKey,
      kinds: allKinds,
    })),
    now: () => clock,
  });
  const signerFor = (row: Record<string, unknown>) => {
    const iss = String(row[c['issuer']!] ?? 'replay');
    const kid = String(row[c['issuerKeyId']!] ?? 'replay');
    return keyFor(iss === '' ? 'replay' : iss, kid === '' ? 'replay' : kid);
  };
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
    const signer = signerFor(row);
    clock = nb;
    fw.registerIntent(
      signIntent(
        {
          intentId: id,
          kind: kind as IntentKind,
          maxAmountPaise: max,
          beneficiaryRef: b,
          maxUses: Number.isSafeInteger(uses) ? uses : 1,
          notBeforeMs: nb,
          expiresAtMs: ex,
          issuer: signer.issuer,
          keyId: signer.keyId,
          ...(sub ? { subjectRef: String(sub) } : {}),
        },
        { alg: 'ed25519', privateKey: signer.pair.privateKey },
      ),
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

  const totals = {
    payouts: 0,
    amountPaise: 0,
    allow: { count: 0, amountPaise: 0 },
    review: { count: 0, amountPaise: 0 },
    block: { count: 0, amountPaise: 0 },
    degraded: 0,
  };
  const ruleAgg = new Map<string, { hits: number; amountPaise: number }>();
  const flagged: FlaggedPayout[] = [];
  const lat: number[] = [];
  const episodes: { startMs: number; endMs: number | null; trigger: string }[] = [];
  const resetMs = (o.alertResetHours ?? 24) * 3_600_000;
  // Intent-less penny-drop state + threshold-suggestion samples.
  const microPaise = cfg.microPaise ?? 1_000;
  const verified = new Map<string, string>();
  const boundVerified = new Set<string>();
  const amounts: number[] = [];
  const microAmounts: number[] = [];
  const nonMicroAmounts: number[] = [];
  const keyWindows = new Map<string, { count: number; sumPaise: number }>();
  let verificationRows = 0;
  let boundPayouts = 0;
  let untaggedMicro = 0;
  const signKey = { alg: 'ed25519' as const, privateKey: issuer.privateKey };
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
    const aids = row[c['approvalIds']!];
    if (typeof aids === 'string' && aids !== '')
      p['approvalIds'] = aids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const kind = String(p['kind']);
    if (intentLess && b !== undefined) {
      if (kind === 'VERIFICATION') {
        // A tagged penny-drop is the lender vouching for this account. Give
        // it a throwaway VERIFICATION intent so the engine's own
        // verified-beneficiary bookkeeping fires — subsequent payouts to it
        // are then exempt from probe/cooling, exactly as under a real intent.
        const subj = row[c['subjectRef']!] !== undefined && row[c['subjectRef']!] !== '' ? String(row[c['subjectRef']!]) : `verified:${b}`;
        try {
          fw.registerIntent(
            signIntent(
              {
                intentId: `replay-verification-${i}`,
                kind: 'VERIFICATION',
                maxAmountPaise: Math.max(amount ?? 1, 1),
                beneficiaryRef: b,
                maxUses: 1,
                notBeforeMs: Math.max(1, at - 3_600_000),
                expiresAtMs: Number.MAX_SAFE_INTEGER,
                issuer: 'replay',
                keyId: 'replay',
                subjectRef: subj,
              },
              signKey,
            ),
            at,
          );
          p['intentId'] = `replay-verification-${i}`;
          if (!verified.has(b)) verified.set(b, subj);
          verificationRows += 1;
        } catch {
          /* malformed row → falls through and is evaluated unbound */
        }
      } else if (verified.has(b)) {
        const subj = verified.get(b)!;
        const iid = `replay-verified-${b}-${kind}`;
        try {
          if (!boundVerified.has(iid)) {
            boundVerified.add(iid);
            fw.registerIntent(
              signIntent(
                {
                  intentId: iid,
                  kind: kind as IntentKind,
                  maxAmountPaise: Number.MAX_SAFE_INTEGER,
                  beneficiaryRef: b,
                  maxUses: 1_000_000_000,
                  notBeforeMs: 1,
                  expiresAtMs: Number.MAX_SAFE_INTEGER,
                  issuer: 'replay',
                  keyId: 'replay',
                  subjectRef: subj,
                },
                signKey,
              ),
              at,
            );
          }
          p['intentId'] = iid;
          boundPayouts += 1;
        } catch {
          /* unhandled kind or bad intent → evaluated unbound */
        }
      }
    }
    if (intentLess && kind !== 'VERIFICATION' && amount !== undefined && amount <= microPaise) untaggedMicro += 1;
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
      flagged.push({
        payoutId: v.payoutId,
        atMs: at,
        kind: String(p['kind']),
        amountPaise: amt,
        beneficiaryRef: b ?? '(missing)',
        sourceKeyId: String(p['sourceKeyId']),
        verdict: v.verdict,
        degraded: v.degraded,
        hits: v.hits.filter((h) => h.verdict !== 'ALLOW'),
      });
    if (amount !== undefined) {
      amounts.push(amount);
      (amount <= microPaise ? microAmounts : nonMicroAmounts).push(amount);
      const wk = `${String(p['sourceKeyId'])}|${Math.floor(at / 600_000)}`;
      const w = keyWindows.get(wk) ?? { count: 0, sumPaise: 0 };
      w.count += 1;
      w.sumPaise += amount;
      keyWindows.set(wk, w);
    }
  }
  lat.sort((a, b) => a - b);
  const pct = (sorted: readonly number[], q: number): number | undefined =>
    sorted.length === 0 ? undefined : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  amounts.sort((a, b) => a - b);
  microAmounts.sort((a, b) => a - b);
  nonMicroAmounts.sort((a, b) => a - b);
  const winCounts = [...keyWindows.values()].map((w) => w.count).sort((a, b) => a - b);
  const winSums = [...keyWindows.values()].map((w) => w.sumPaise).sort((a, b) => a - b);
  const pennyDrop: ReplayReport['pennyDrop'] | undefined = intentLess
    ? {
        verificationRows,
        verifiedBeneficiaries: verified.size,
        boundPayouts,
        untaggedMicro,
        ...(untaggedMicro > 0 && verificationRows === 0
          ? {
              tip: `${untaggedMicro} payouts at or below ${microPaise} paise look like penny drops, but none are tagged kind=VERIFICATION — tag them so they are read as account verifications, not probes.`,
            }
          : {}),
      }
    : undefined;
  const suggested: ReplayReport['suggested'] | undefined = intentLess
    ? {
        config: {
          firewall: { ...(microAmounts.length >= 5 ? { microPaise: pct(microAmounts, 0.95)! } : {}) },
          rules: {
            ...(nonMicroAmounts.length >= 10 ? { probe: { largePaise: pct(nonMicroAmounts, 0.25)! } } : {}),
            ...(amounts.length >= 10 ? { cooling: { minAmountPaise: pct(amounts, 0.75)! } } : {}),
            ...(winCounts.length >= 2
              ? { velocity: { perSourceKey: { count: pct(winCounts, 0.99)!, sumPaise: pct(winSums, 0.99)! } } }
              : {}),
          },
        },
        percentiles: {
          windowCountP95: pct(winCounts, 0.95) ?? 0,
          windowCountP99: pct(winCounts, 0.99) ?? 0,
          windowSumP95Paise: pct(winSums, 0.95) ?? 0,
          windowSumP99Paise: pct(winSums, 0.99) ?? 0,
          amountP75Paise: pct(amounts, 0.75) ?? 0,
          ...(nonMicroAmounts.length > 0 ? { nonMicroP25Paise: pct(nonMicroAmounts, 0.25)! } : {}),
          ...(microAmounts.length > 0 ? { microP95Paise: pct(microAmounts, 0.95)! } : {}),
        },
      }
    : undefined;
  return {
    generatedAt: new Date().toISOString(),
    intentLess,
    inputRows: o.payouts.length,
    skippedRows: skipped,
    totals,
    topRules: [...ruleAgg].map(([rule, a]) => ({ rule, ...a })).sort((x, y) => y.hits - x.hits),
    chains: chains(flagged),
    falsePositiveReview: flagged
      .filter((f) => f.verdict === 'REVIEW' && f.hits.length === 1)
      .sort((a, b) => b.amountPaise - a.amountPaise)
      .slice(0, 50),
    flagged,
    alertEpisodes: episodes,
    p99Micros: lat.length === 0 ? 0 : lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.99))]!,
    ...(pennyDrop !== undefined ? { pennyDrop } : {}),
    ...(suggested !== undefined ? { suggested } : {}),
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
    .map((g) => {
      const steps = [...g].sort((a, b) => a.atMs - b.atMs);
      return {
        key: steps[0]!.sourceKeyId,
        startMs: steps[0]!.atMs,
        endMs: steps[steps.length - 1]!.atMs,
        amountPaise: steps.reduce((a, f) => a + f.amountPaise, 0),
        worst: steps.some((f) => f.verdict === 'BLOCK') ? ('BLOCK' as const) : ('REVIEW' as const),
        rules: [...new Set(steps.flatMap((f) => f.hits.map((h) => h.rule)))],
        steps,
      };
    })
    .sort((a, b) => b.amountPaise - a.amountPaise);
}
