// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AuthorizationError, hashBeneficiary, looksLikeRawIdentifier, INTENT_KINDS, type BeneficiaryIdentifier, type IntentKind, type MintSpec, type Mode, type Payrekha, type PayoutOutcome, type PayoutRequest, type PayoutVerdict, type SignerKey, type StateStore } from '@payrekha/core';
import { decisionRecord, type DecisionLog } from './log.js';
import { mapPayout, type FieldMapping } from './mapping.js';
import { renderMetrics } from './metrics.js';
import { SharedStateDriver, type SharedStateOptions } from './shared.js';
import type { WebhookSender } from './webhook.js';

/** What an API key may call. `read` covers GET /v1/state and /metrics. */
export type ApiRole = 'evaluate' | 'intents' | 'outcomes' | 'read' | 'mint';
export const API_ROLES: readonly ApiRole[] = ['evaluate', 'intents', 'outcomes', 'read', 'mint'];

export interface ApiKey {
  /** Stable id: becomes `sourceKeyId` on every payout this key evaluates. */
  readonly id: string;
  /** SHA-256 hex of the bearer token. The token itself is never stored. */
  readonly sha256: string;
  /** Network origin the key belongs to. Never taken from the request body. */
  readonly origin: 'prod' | 'nonprod';
  /**
   * What the key may call. Absent = every role (legacy behaviour). Grant
   * narrowly: the payout caller gets `evaluate` (+`outcomes` if it reports
   * rail status), the system of record gets `intents`, dashboards `read`.
   */
  readonly roles?: readonly ApiRole[];
  /**
   * Merchant ids this key may submit payouts for (PA settlement model). When
   * set, a payout whose `merchantId` is outside the list is refused 403 —
   * `merchantId` scopes shared mutable state (velocity rings, account-change
   * ledger), so an untrusted key must not mint or impersonate merchants.
   * Absent = unrestricted (suitable for the payout API itself).
   */
  readonly merchantIds?: readonly string[];
}

export interface ExtAuthzOptions {
  readonly mapping: FieldMapping;
  /** Origin of the payout API Envoy guards. */
  readonly origin: 'prod' | 'nonprod';
  /** Optional: header Envoy sets per route to override `origin` (e.g. `x-payrekha-origin`). */
  readonly originHeader?: string;
  /** SHA-256 hex of the shared key Envoy sends in `x-payrekha-key`. Omit only on an isolated network. */
  readonly keySha256?: string;
  /**
   * Permit ext_authz without a key — anyone who can reach the port can then
   * evaluate payouts and spend intents under sourceKeyId 'ext_authz'. Required
   * explicitly when keySha256 is unset; absent this + absent key, boot refuses.
   */
  readonly allowInsecure?: boolean;
  /**
   * Honour the timestamp that `mapping.timestampMs` resolves. Default false:
   * the check runs at gateway time and the mapped value is kept as
   * `clientTimestampMs` evidence — a client-controlled clock must not move
   * intent windows, velocity budgets or cooling periods.
   */
  readonly trustClientTimestamp?: boolean;
}

export interface GatewayOptions {
  readonly firewall: Payrekha;
  readonly apiKeys: readonly ApiKey[];
  /** SHA-256 hex of the admin bearer token; must match the firewall's adminTokenSha256. */
  readonly adminKeySha256?: string;
  /** Keyed-hash secret for raw beneficiary fields hashed at entry. */
  readonly hashKey?: string;
  readonly decisionLog?: DecisionLog;
  readonly webhook?: WebhookSender;
  readonly extAuthz?: ExtAuthzOptions;
  readonly stateStore?: StateStore;
  /**
   * ADR 0004 active-active shared state. When set, intent consumption for
   * `commitPolicy` kinds commits atomically through the backend before a
   * non-DECLINE verdict leaves — two replicas can never double-spend an
   * intent use or bind the same payoutId twice. Store down fails closed:
   * enforce-mode payouts DECLINE, others degrade. There is no allow-on-outage.
   */
  readonly sharedState?: SharedStateOptions;
  /**
   * Trust a `timestampMs` field in the request body. Default false: the
   * gateway stamps server time (and keeps the caller's value as
   * `clientTimestampMs` evidence). Only for callers trusted to report time;
   * `FirewallConfig.maxTimestampSkewMs` still bounds whatever is sent.
   */
  readonly trustClientTimestamp?: boolean;
  /**
   * Max signature verifications one key may spend on POST /v1/intents per
   * minute — verification is the expensive unit, not requests. Default 5000
   * (a 1000-intent backfill ×5/min). A stolen `intents` key then cannot
   * stall the event loop with Ed25519 spam.
   */
  readonly intentVerificationsPerMinute?: number;
  /**
   * Managed intents: POST /v1/intents/mint builds, signs and registers an
   * intent with a gateway-held key — the lowest-effort adoption tier for a
   * system of record. Anyone who can call mint can authorise payouts up to
   * the signing key's kinds, so keep it on a separate `mint`-role API key and
   * prefer externally-signed intents in enforce mode. Guardrails bound what a
   * stolen mint key can do: `maxAmountPaise` caps each intent's amount,
   * `mintsPerMinute` bounds the signing rate (default 60), and `modes`
   * restricts minting to named effective modes (e.g. shadow/advise only).
   */
  readonly mint?: {
    readonly keyId: string;
    readonly key: SignerKey;
    readonly defaultTtlMs: number;
    readonly maxTtlMs: number;
    /** Ceiling on a minted intent's maxAmountPaise. Unset = no cap beyond kind scope. */
    readonly maxAmountPaise?: number;
    /** Mints per minute per API key. Default 60. */
    readonly mintsPerMinute?: number;
    /** Effective modes in which minting is allowed, e.g. `['shadow','advise']`. Unset = all modes. */
    readonly modes?: readonly Mode[];
  };
  readonly maxBodyBytes?: number;
  readonly now?: () => number;
  readonly version?: string;
  readonly onError?: (where: string, err: unknown) => void;
}

export interface GatewayHandle {
  readonly server: Server;
  readonly stats: GatewayStats;
  setReady(ready: boolean, reason?: string): void;
  /** Resolves false when there is no store or the save failed. A second writer marks the gateway not ready. */
  saveState(): Promise<boolean>;
  /** Stop the shared-state poll and release its backend. Safe without shared state. */
  closeShared(): Promise<void>;
}

export interface GatewayStats {
  requests: Map<string, number>;
  stateSaveErrors: number;
  logErrors: number;
  ready: boolean;
  notReadyReason: string;
  /** Live reference into the SharedStateDriver counters — only set when sharedState is configured. */
  shared?: SharedStateDriver['metrics'];
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();
const hexEq = (token: string, hex: string) => /^[0-9a-f]{64}$/i.test(hex) && timingSafeEqual(sha256(token), Buffer.from(hex, 'hex'));
const REQ_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7).trim() : undefined;
}

async function readBody(req: IncomingMessage, max: number): Promise<unknown> {
  const enc = req.headers['content-encoding'];
  if (enc !== undefined && enc !== 'identity') throw new HttpError(415, `unsupported content-encoding '${enc.slice(0, 32)}' — send the payout as plain JSON`);
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > max) throw new HttpError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  if (n === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return Symbol.for('payrekha.unparseable');
  }
}

/** Raw beneficiary on /v1/evaluate → hashed at entry, then dropped. */
function hashAtEntry(body: Record<string, unknown>, key: string | undefined): void {
  const raw = body['beneficiary'];
  delete body['beneficiary'];
  const mob = body['beneficiaryMobile'];
  delete body['beneficiaryMobile'];
  if (key === undefined) return;
  if (body['beneficiaryRef'] === undefined && raw !== null && typeof raw === 'object') {
    try {
      body['beneficiaryRef'] = hashBeneficiary(raw as BeneficiaryIdentifier, key);
    } catch {
      /* leave missing → degraded REVIEW */
    }
  }
  if (body['beneficiaryMobileRef'] === undefined && typeof mob === 'string') {
    try {
      body['beneficiaryMobileRef'] = hashBeneficiary({ mobile: mob }, key);
    } catch {
      /* skip feed lookup */
    }
  }
}

export function createGateway(o: GatewayOptions): GatewayHandle {
  if (o.extAuthz !== undefined && o.extAuthz.keySha256 === undefined && o.extAuthz.allowInsecure !== true)
    throw new Error('ext_authz configured without a key — set keySha256 or explicitly set allowInsecure: true (isolated networks only)');
  const fw = o.firewall;
  const now = o.now ?? Date.now;
  const max = o.maxBodyBytes ?? 64 * 1024;
  let saving = false;
  const stats: GatewayStats = { requests: new Map(), stateSaveErrors: 0, logErrors: 0, ready: true, notReadyReason: '' };
  const onError = o.onError ?? (() => undefined);

  const intentCost = new Map<string, { reset: number; used: number }>();
  const mintCost = new Map<string, { reset: number; used: number }>();
  const recentDecisions: ReturnType<typeof decisionRecord>[] = [];
  // ADR 0004: store-reachability drives readiness — an impaired money path is
  // a not-ready pod, exactly what an LB should drain. Only our own reason is
  // restored on recovery (a split-brain 'not ready' stays latched).
  const setSharedReady = (ok: boolean) => {
    if (!ok) {
      stats.ready = false;
      stats.notReadyReason = 'shared state unreachable';
    } else if (stats.notReadyReason === 'shared state unreachable') {
      stats.ready = true;
      stats.notReadyReason = '';
    }
  };
  const shared = o.sharedState === undefined ? undefined : new SharedStateDriver(fw, o.sharedState, onError, setSharedReady, now);
  if (shared !== undefined) stats.shared = shared.metrics;
  shared?.start();
  const authKey = (req: IncomingMessage, role: ApiRole): ApiKey => {
    const t = bearer(req);
    const k = t === undefined ? undefined : o.apiKeys.find((a) => hexEq(t, a.sha256));
    if (k === undefined) throw new HttpError(401, 'missing or unknown API key');
    if (k.roles !== undefined && !k.roles.includes(role)) throw new HttpError(403, `key '${k.id}' lacks the '${role}' role`);
    return k;
  };
  const authAdmin = (req: IncomingMessage): string => {
    const t = bearer(req);
    if (o.adminKeySha256 === undefined || t === undefined || !hexEq(t, o.adminKeySha256)) throw new HttpError(401, 'admin key required');
    return t;
  };

  const record = (v: PayoutVerdict, p: unknown, rid: string, via: 'evaluate' | 'ext_authz') => {
    const rec = decisionRecord(v, p as Partial<PayoutRequest>, rid, via, now());
    recentDecisions.push(rec);
    if (recentDecisions.length > 1_000) recentDecisions.shift();
    try {
      o.decisionLog?.write(rec);
    } catch (e) {
      stats.logErrors += 1;
      onError('decision-log', e);
    }
    if (v.verdict === 'BLOCK' && !v.deduped)
      o.webhook?.send({ type: 'payout.blocked', atMs: now(), decisionId: v.decisionId, payoutId: v.payoutId, rules: v.hits.map((h) => h.rule), mode: v.mode, effectiveAction: v.effectiveAction });
  };

  const evaluate = async (body: unknown, key: ApiKey, rid: string, peerHint?: string): Promise<PayoutVerdict> => {
    const p = body !== null && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : body;
    if (p !== null && typeof p === 'object') {
      const b = p as Record<string, unknown>;
      hashAtEntry(b, o.hashKey);
      b['sourceKeyId'] = key.id;
      b['origin'] = key.origin;
      // The caller cannot assert its own source identity — the socket peer
      // is the only honest hint on this path (richer hints use ext_authz).
      delete b['sourceHint'];
      if (peerHint !== undefined && peerHint !== '') b['sourceHint'] = peerHint;
      if (key.merchantIds !== undefined) {
        const mid = b['merchantId'];
        if (typeof mid === 'string' ? !key.merchantIds.includes(mid) : b['kind'] === 'PA_SETTLEMENT')
          throw new HttpError(403, `key '${key.id}' is not scoped to merchantId '${typeof mid === 'string' ? mid.slice(0, 64) : '—'}'`);
      }
      const claimed = b['timestampMs'];
      delete b['clientTimestampMs'];
      b['timestampMs'] = now();
      // The caller's clock never moves a rule: its value is kept as evidence.
      if (o.trustClientTimestamp === true && claimed !== undefined) b['timestampMs'] = claimed;
      else if (typeof claimed === 'number' && Number.isFinite(claimed) && claimed !== b['timestampMs']) b['clientTimestampMs'] = claimed;
    }
    const v0 = fw.evaluate(p as PayoutRequest);
    const v = shared === undefined ? v0 : await shared.finalize(v0, p as PayoutRequest);
    record(v, p, rid, 'evaluate');
    return v;
  };

  const routes = async (req: IncomingMessage, res: ServerResponse, rid: string): Promise<[number, unknown, Record<string, string>?]> => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const m = req.method ?? 'GET';
    if (path === '/healthz') return [200, { ok: true }];
    if (path === '/readyz') return stats.ready ? [200, { ready: true }] : [503, { ready: false, reason: stats.notReadyReason }];
    if (path === '/metrics' && m === 'GET') {
      authKey(req, 'read');
      res.setHeader('content-type', 'text/plain; version=0.0.4');
      return [200, renderMetrics(fw, stats, o.webhook, o.decisionLog?.errors ?? 0)];
    }
    if (!stats.ready) throw new HttpError(503, `not ready: ${stats.notReadyReason}`);
    if (path.startsWith('/ext_authz') && o.extAuthz !== undefined) return extAuthz(req, res, rid, url);
    if (path === '/v1/evaluate' && m === 'POST') {
      const key = authKey(req, 'evaluate');
      const body = await readBody(req, max);
      return [200, await evaluate(body, key, rid, req.socket.remoteAddress)];
    }
    if (path === '/v1/intents' && m === 'POST') {
      const key = authKey(req, 'intents');
      const body = await readBody(req, max);
      const list = Array.isArray(body) ? body : [body];
      if (list.length > 1_000) throw new HttpError(413, 'at most 1000 intents per call');
      // Verification is the expensive unit — bound it per key, per minute.
      const budget = o.intentVerificationsPerMinute ?? 5_000;
      const t = now();
      let b = intentCost.get(key.id);
      if (b === undefined || t >= b.reset) {
        b = { reset: t + 60_000, used: 0 };
        intentCost.set(key.id, b);
      }
      if (b.used + list.length > budget) throw new HttpError(429, `intent verification budget exceeded (${budget}/min)`);
      b.used += list.length;
      const results = list.map((i) => fw.registerIntent(i, now()));
      if (shared !== undefined) {
        // Write-through before reporting success: an intent a replica cannot
        // see must not look registered. Retry is safe — puts are idempotent.
        for (const [n, r] of results.entries()) {
          if (!r.accepted) continue;
          try {
            await shared.writeThroughIntent(list[n]);
          } catch {
            throw new HttpError(503, `shared-state write-through failed for '${r.intentId}' — retry the call`);
          }
        }
      }
      const status = results.every((r) => r.accepted) ? 201 : results.some((r) => r.accepted) ? 207 : 422;
      return [status, Array.isArray(body) ? { results } : results[0]];
    }
    if (path === '/v1/intents/mint' && m === 'POST') {
      const key = authKey(req, 'mint');
      if (o.mint === undefined) throw new HttpError(503, 'managed intents are not configured on this gateway');
      // Minting signs intents — bound how fast one key may spend that power,
      // charged before the body is read so rate-limited spam stays cheap.
      const mintBudget = o.mint.mintsPerMinute ?? 60;
      const t = now();
      let mb = mintCost.get(key.id);
      if (mb === undefined || t >= mb.reset) {
        mb = { reset: t + 60_000, used: 0 };
        mintCost.set(key.id, mb);
      }
      if (mb.used + 1 > mintBudget) throw new HttpError(429, `mint budget exceeded (${mintBudget}/min)`);
      mb.used += 1;
      const body = await readBody(req, max);
      if (typeof body !== 'object' || body === null) throw new HttpError(400, 'a JSON object is required');
      const b = body as Record<string, unknown>;
      // Same deal as /v1/evaluate: raw beneficiary fields are hashed at entry.
      hashAtEntry(b, o.hashKey);
      const kind = b['kind'];
      const amount = b['maxAmountPaise'] ?? b['amountPaise'];
      const ref = b['beneficiaryRef'];
      const intentId = b['intentId'];
      const subjectRef = b['subjectRef'];
      const maxUses = b['maxUses'];
      const ttlMs = b['ttlMs'];
      const notBeforeMs = b['notBeforeMs'];
      if (!INTENT_KINDS.includes(kind as IntentKind)) throw new HttpError(400, 'kind must be a known IntentKind');
      if (!Number.isSafeInteger(amount) || (amount as number) <= 0) throw new HttpError(400, 'maxAmountPaise (or amountPaise) must be a positive integer');
      if (typeof ref !== 'string' || looksLikeRawIdentifier(ref)) throw new HttpError(400, 'beneficiaryRef (hashed) or raw beneficiary fields are required');
      if (intentId !== undefined && (typeof intentId !== 'string' || intentId.length === 0 || intentId.length > 128)) throw new HttpError(400, 'intentId must be a string of at most 128 chars');
      if (subjectRef !== undefined && typeof subjectRef !== 'string') throw new HttpError(400, 'subjectRef must be a string');
      if (maxUses !== undefined && (!Number.isSafeInteger(maxUses) || (maxUses as number) < 1 || (maxUses as number) > 1_000_000)) throw new HttpError(400, 'maxUses must be an integer 1..1e6');
      if (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || (ttlMs as number) < 1 || (ttlMs as number) > o.mint.maxTtlMs)) throw new HttpError(400, `ttlMs must be within 1..${o.mint.maxTtlMs}`);
      if (notBeforeMs !== undefined && !Number.isSafeInteger(notBeforeMs)) throw new HttpError(400, 'notBeforeMs must be epoch ms');
      if (o.mint.maxAmountPaise !== undefined && (amount as number) > o.mint.maxAmountPaise) throw new HttpError(400, `maxAmountPaise above the mint ceiling (${o.mint.maxAmountPaise})`);
      if (o.mint.modes !== undefined) {
        const cm = fw.currentMode;
        const eff = cm.modeByKind[kind as IntentKind] ?? cm.mode;
        if (!o.mint.modes.includes(eff)) throw new HttpError(403, `minting disabled while ${String(kind)} is in ${eff} mode (gateway.mint.modes)`);
      }
      const spec: MintSpec = {
        keyId: o.mint.keyId,
        key: o.mint.key,
        kind: kind as IntentKind,
        maxAmountPaise: amount as number,
        beneficiaryRef: ref,
        ...(intentId !== undefined ? { intentId } : {}),
        ...(subjectRef !== undefined ? { subjectRef } : {}),
        ...(maxUses !== undefined ? { maxUses: maxUses as number } : {}),
        ...(ttlMs !== undefined ? { ttlMs: ttlMs as number } : { ttlMs: o.mint.defaultTtlMs }),
        ...(notBeforeMs !== undefined ? { notBeforeMs: notBeforeMs as number } : {}),
      };
      const res = fw.mintIntent(spec, key.id, now());
      if (res.accepted && shared !== undefined) {
        try {
          await shared.writeThroughIntent({ intentId: res.intentId });
        } catch {
          throw new HttpError(503, 'shared-state write-through failed — retry the mint (same intentId is idempotent)');
        }
      }
      return [res.accepted ? 201 : 422, res];
    }
    if (path === '/v1/outcomes' && m === 'POST') {
      const key = authKey(req, 'outcomes');
      const b = (await readBody(req, max)) as { payoutId?: unknown; outcome?: unknown } | undefined;
      if (typeof b?.payoutId !== 'string' || !['settled', 'failed', 'reversed'].includes(b.outcome as string)) throw new HttpError(400, 'payoutId and outcome (settled|failed|reversed) required');
      // With shared state the reservation row is the truth: apply the outcome
      // there first (a replica may never have held the payout locally), then
      // to local counters. Failure → 503; the call is safe to retry.
      let remote = false;
      if (shared !== undefined) {
        try {
          remote = await shared.applyOutcome(b.payoutId, b.outcome as 'settled' | 'failed' | 'reversed', key.id);
        } catch {
          throw new HttpError(503, 'shared-state outcome write failed — retry the call');
        }
      }
      const known = fw.reportOutcome(b.payoutId, b.outcome as PayoutOutcome, key.id);
      return [200, { payoutId: b.payoutId, known: remote || known }];
    }
    if (path === '/v1/state' && m === 'GET') {
      authKey(req, 'read');
      return [200, stateView()];
    }
    // Analyst surface: recent verdicts, audit trail and intent state — a
    // documented read API so consoles/triage tools can sit on top.
    if (path === '/v1/decisions' && m === 'GET') {
      authKey(req, 'read');
      const verdict = url.searchParams.get('verdict');
      const payoutId = url.searchParams.get('payoutId');
      const intentId = url.searchParams.get('intentId');
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 200, 1), 500);
      let rows = recentDecisions;
      if (verdict !== null) rows = rows.filter((r) => r.verdict === verdict.toUpperCase());
      if (payoutId !== null) rows = rows.filter((r) => r.payoutId === payoutId.slice(0, 128));
      if (intentId !== null) rows = rows.filter((r) => r.intentId === intentId);
      return [200, { decisions: rows.slice(-limit).reverse(), total: rows.length }];
    }
    if (path === '/v1/audit' && m === 'GET') {
      authKey(req, 'read');
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 200, 1), 1_000);
      return [200, { audit: fw.auditEntries.slice(-limit).reverse() }];
    }
    if (path.startsWith('/v1/intents/') && path !== '/v1/intents/mint' && m === 'GET') {
      authKey(req, 'read');
      let intentId: string;
      try {
        intentId = decodeURIComponent(path.slice('/v1/intents/'.length));
      } catch {
        throw new HttpError(400, 'malformed intentId');
      }
      const rec = fw.intents.get(intentId);
      if (rec === undefined) throw new HttpError(404, 'unknown intentId');
      const { signature: _s, ...intent } = rec.intent;
      void _s;
      return [200, { intent, uses: rec.uses, usedPaise: rec.usedPaise, remainingPaise: Math.max(0, rec.intent.maxAmountPaise - rec.usedPaise), verification: rec.verification }];
    }
    if (path === '/v1/state' && m === 'PUT') {
      const token = authAdmin(req);
      const b = ((await readBody(req, max)) ?? {}) as { mode?: Mode; kind?: IntentKind; highAlert?: 'raise' | 'reset'; actor?: string; reason?: string };
      const cred = { actor: String(b.actor ?? 'admin').slice(0, 64), reason: String(b.reason ?? '').slice(0, 256), adminToken: token };
      if (cred.reason === '') throw new HttpError(400, 'reason is required (it goes in the audit trail)');
      // Apply locally first (audits the real admin), then write the control
      // row so other replicas converge — a failed push is retried by the caller.
      if (b.highAlert === 'raise') fw.raiseHighAlert(cred.actor, cred.reason);
      if (b.highAlert === 'reset') fw.resetHighAlert(cred);
      if (b.mode !== undefined) fw.setMode(b.mode, cred, b.kind);
      if (shared !== undefined && (b.highAlert !== undefined || b.mode !== undefined)) {
        try {
          await shared.pushControl((cur) => ({
            ...cur,
            // First alarm wins — a second replica's raise must not overwrite the original reason.
            ...(b.highAlert === 'raise' && (cur.highAlert === undefined || cur.highAlert === null) ? { highAlert: { since: now(), reason: cred.reason } } : {}),
            ...(b.highAlert === 'reset' ? { highAlert: null } : {}),
            ...(b.mode !== undefined && b.kind === undefined ? { mode: b.mode } : {}),
            ...(b.mode !== undefined && b.kind !== undefined ? { modeByKind: { ...cur.modeByKind, [b.kind]: b.mode } } : {}),
          }));
        } catch {
          throw new HttpError(503, 'applied locally; shared-state propagation failed — retry the call');
        }
      }
      return [200, stateView()];
    }
    if (path.startsWith('/v1/issuers/') && m === 'DELETE') {
      const token = authAdmin(req);
      let keyId: string;
      try {
        keyId = decodeURIComponent(path.slice('/v1/issuers/'.length));
      } catch {
        throw new HttpError(400, 'bad keyId percent-encoding');
      }
      if (keyId === '' || keyId.includes('/')) throw new HttpError(400, 'keyId required');
      const b = ((await readBody(req, max)) ?? {}) as { actor?: string; reason?: string };
      const cred = { actor: String(b.actor ?? 'admin').slice(0, 64), reason: String(b.reason ?? '').slice(0, 256), adminToken: token };
      if (cred.reason === '') throw new HttpError(400, 'reason is required (it goes in the audit trail)');
      const ok = fw.revokeIssuerKey(keyId, cred);
      if (ok && shared !== undefined) {
        try {
          await shared.pushControl((cur) => ({ ...cur, revokedKeyIds: [...new Set([...(cur.revokedKeyIds ?? []), keyId])] }));
        } catch {
          throw new HttpError(503, 'revoked locally; shared-state propagation failed — retry the call');
        }
      }
      return [ok ? 200 : 404, { keyId, revoked: ok, issuers: fw.keyring.list() }];
    }
    if (path === '/v1/canaries' && m === 'POST') {
      const token = authAdmin(req);
      const b = ((await readBody(req, max)) ?? {}) as { beneficiaryRefs?: string[]; beneficiaries?: BeneficiaryIdentifier[]; sourceKeyIds?: string[]; intentIds?: string[]; actor?: string; reason?: string };
      const refs = [...(b.beneficiaryRefs ?? [])];
      if (refs.some((r) => typeof r !== 'string' || looksLikeRawIdentifier(r))) throw new HttpError(400, 'beneficiaryRefs must be hashed; send raw ids under "beneficiaries"');
      for (const raw of b.beneficiaries ?? []) {
        if (o.hashKey === undefined) throw new HttpError(400, 'raw beneficiaries need PAYREKHA_HASH_KEY');
        refs.push(hashBeneficiary(raw, o.hashKey));
      }
      const n = fw.addCanaries(
        { beneficiaryRefs: refs, sourceKeyIds: b.sourceKeyIds ?? [], intentIds: b.intentIds ?? [] },
        { actor: String(b.actor ?? 'admin'), reason: String(b.reason ?? 'canary registration'), adminToken: token },
      );
      return [201, { canaries: n }];
    }
    throw new HttpError(404, 'not found');
  };

  const extAuthz = async (req: IncomingMessage, res: ServerResponse, rid: string, url: URL): Promise<[number, unknown, Record<string, string>?]> => {
    const x = o.extAuthz!;
    if (x.keySha256 !== undefined) {
      const k = req.headers['x-payrekha-key'];
      if (typeof k !== 'string' || !hexEq(k, x.keySha256)) throw new HttpError(401, 'x-payrekha-key required');
    }
    const body = await readBody(req, max);
    const hdrOrigin = x.originHeader !== undefined ? req.headers[x.originHeader.toLowerCase()] : undefined;
    const origin = hdrOrigin === 'prod' || hdrOrigin === 'nonprod' ? hdrOrigin : x.origin;
    const payout = mapPayout(
      { path: url.pathname.replace(/^\/ext_authz/, '') || '/', headers: req.headers, query: Object.fromEntries(url.searchParams), body: typeof body === 'symbol' ? undefined : body },
      x.mapping,
      o.hashKey,
      { origin, nowMs: now(), trustClientTimestamp: x.trustClientTimestamp === true },
    );
    const v0 = fw.evaluate(payout as unknown as PayoutRequest);
    const v = shared === undefined ? v0 : await shared.finalize(v0, payout as unknown as PayoutRequest);
    record(v, payout, rid, 'ext_authz');
    const headers = {
      'x-payrekha-verdict': v.verdict,
      'x-payrekha-action': v.effectiveAction,
      'x-payrekha-decision-id': v.decisionId,
      'x-payrekha-rules': v.hits.map((h) => h.rule).join(',') || '-',
    };
    void res;
    // Shadow → effectiveAction is always ALLOW → 200. HOLD and DECLINE both stop the call.
    return [v.effectiveAction === 'ALLOW' ? 200 : 403, { verdict: v.verdict, effectiveAction: v.effectiveAction, decisionId: v.decisionId, rules: headers['x-payrekha-rules'] }, headers];
  };

  const stateView = () => ({
    ...fw.currentMode,
    alertState: fw.alertState,
    highAlert: fw.highAlertInfo,
    rules: fw.ruleNames,
    issuers: fw.keyring.list(),
    version: o.version ?? '0.1.0-alpha.0',
  });

  // Bound the obvious resource levers: slow header drip and a request that
  // never finishes. Verdicts complete in microseconds; these are generous.
  const server = createServer({ headersTimeout: 15_000, requestTimeout: 30_000 }, (req, res) => {
    const inbound = req.headers['x-request-id'];
    const rid = typeof inbound === 'string' && REQ_ID.test(inbound) ? inbound : randomUUID();
    res.setHeader('x-request-id', rid);
    res.setHeader('cache-control', 'no-store');
    routes(req, res, rid)
      .then(([status, body, headers]) => send(res, status, body, headers))
      .catch((e: unknown) => {
        if (e instanceof HttpError) return send(res, e.status, { error: e.message, requestId: rid });
        if (e instanceof AuthorizationError) return send(res, 403, { error: e.message, requestId: rid });
        if (e instanceof TypeError) return send(res, 400, { error: e.message, requestId: rid });
        onError('request', e);
        return send(res, 500, { error: 'internal error', requestId: rid });
      })
      .finally(() => {
        const key = `${req.method ?? 'GET'} ${routeLabel(req.url ?? '/')} ${res.statusCode}`;
        stats.requests.set(key, (stats.requests.get(key) ?? 0) + 1);
      });
  });

  return {
    server,
    stats,
    setReady(ready, reason = '') {
      stats.ready = ready;
      stats.notReadyReason = reason;
    },
    async saveState() {
      // Never write while unready: a not-yet-read or contested snapshot must not be overwritten.
      if (o.stateStore === undefined || saving || !stats.ready) return false;
      saving = true;
      try {
        await o.stateStore.save(fw);
        return true;
      } catch (e) {
        stats.stateSaveErrors += 1;
        onError('state-save', e);
        // Fail closed: someone else is writing this firewall's state.
        if (e instanceof Error && e.name === 'StaleStateError') {
          stats.ready = false;
          stats.notReadyReason = 'state written by another instance';
        }
        return false;
      } finally {
        saving = false;
      }
    },
    async closeShared() {
      await shared?.close();
    },
  };
}

function routeLabel(url: string): string {
  const p = url.split('?')[0] ?? '/';
  if (p.startsWith('/ext_authz')) return '/ext_authz';
  if (p.startsWith('/v1/issuers/')) return '/v1/issuers';
  if (p.startsWith('/v1/intents/') && p !== '/v1/intents/mint') return '/v1/intents/item';
  return ['/v1/evaluate', '/v1/intents', '/v1/intents/mint', '/v1/outcomes', '/v1/state', '/v1/decisions', '/v1/audit', '/v1/canaries', '/healthz', '/readyz', '/metrics'].includes(p) ? p : 'other';
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (typeof body === 'string') {
    res.statusCode = status;
    res.end(body);
    return;
  }
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
