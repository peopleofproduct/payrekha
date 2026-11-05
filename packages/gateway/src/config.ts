// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FileStateStore, Payrekha, signIntent, type FirewallConfig, type IssuerKey, type SignerKey, type StateStore } from '@payrekha/core';
import { payrekhaRules, type RulesConfig } from '@payrekha/rules';
import { auditRecord, fileDecisionLog } from './log.js';
import { API_ROLES, createGateway, type ApiKey, type ApiRole, type ExtAuthzOptions, type GatewayHandle } from './server.js';
import { WebhookSender } from './webhook.js';

/** `payrekha.json`: everything except secrets, which come from the environment. */
export interface PayrekhaFileConfig {
  readonly firewall?: FirewallConfig;
  readonly rules?: RulesConfig;
  readonly issuers?: readonly IssuerKey[];
  /** Path to a calendar JSON ({ holidays: [{date, name}] }), merged into firewall.calendar. */
  readonly calendarFile?: string;
  readonly feedSnapshot?: string;
  readonly extAuthz?: ExtAuthzOptions;
  /** Gateway behaviour. `trustClientTimestamp` honours caller timestamps — leave false unless the caller is trusted. */
  readonly gateway?: {
    readonly trustClientTimestamp?: boolean;
    /** Key id → merchantIds the key may submit for. Scopes the PA settlement surface. */
    readonly merchantScope?: Readonly<Record<string, readonly string[]>>;
    /**
     * Managed intents (POST /v1/intents/mint): keyId must be an ed25519 issuer
     * in `issuers`; the private key comes from PAYREKHA_MINT_KEY.
     */
    readonly mint?: { readonly keyId?: string; readonly defaultTtlMs?: number; readonly maxTtlMs?: number };
  };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

const ROLE_SET = new Set<string>(API_ROLES);

/**
 * `id:origin:token,…` (every role, legacy) or `id:origin:role+role:token,…`
 * → hashed ApiKey list. Tokens are hashed immediately and never kept. The
 * role segment is read as roles only when every `+`-separated part names a
 * known role, so a token containing colons still parses.
 */
export function parseApiKeys(spec: string): ApiKey[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, origin, ...rest] = s.split(':');
      let roles: ApiRole[] | undefined;
      if (rest.length > 1 && rest[0] !== undefined && rest[0].split('+').every((r) => ROLE_SET.has(r))) {
        roles = rest[0].split('+') as ApiRole[];
        rest.shift();
      }
      const token = rest.join(':');
      if (id === undefined || (origin !== 'prod' && origin !== 'nonprod') || token.length < 16)
        throw new Error('PAYREKHA_API_KEYS entries are id:prod|nonprod[:role+role]:token (token ≥ 16 chars)');
      return { id, origin, sha256: sha(token), ...(roles !== undefined ? { roles } : {}) };
    });
}

/** A required-positive-integer env var. Fail loud at boot — `setInterval(NaN)` spins at ~1ms and a NaN port never listens. */
export function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer (got '${raw}')`);
  return n;
}

export interface Booted {
  readonly firewall: Payrekha;
  readonly gateway: GatewayHandle;
  readonly feed: ReturnType<typeof payrekhaRules>['feed'];
  readonly config: PayrekhaFileConfig;
  readonly stateStore?: StateStore;
  /** Settles after the first state-load attempt. The gateway stays unready (503) until a load succeeds. */
  readonly stateLoaded: Promise<void>;
}

type PgStoreCtor = new (o: { connectionString: string; table?: string; name?: string; hmacKey?: string; previousKeys?: readonly string[] }) => StateStore;

/** Postgres support is a separate package so the gateway itself never depends on a DB driver. */
function postgresStore(url: string, table: string | undefined, name: string | undefined, hmacKey: string | undefined, previousKeys: string[]): StateStore {
  const spec = '@payrekha/store-postgres';
  const store: Promise<StateStore> = import(spec).then(
    (m: { PostgresStateStore: PgStoreCtor }) => new m.PostgresStateStore({ connectionString: url, ...(table !== undefined ? { table } : {}), ...(name !== undefined ? { name } : {}), ...(hmacKey !== undefined ? { hmacKey } : {}), ...(previousKeys.length > 0 ? { previousKeys } : {}) }),
    () => {
      throw new Error('PAYREKHA_STATE_PG_URL is set but @payrekha/store-postgres is not installed');
    },
  );
  store.catch(() => undefined);
  return {
    describe: `postgres:${table ?? 'payrekha_state'}/${name ?? 'default'}`,
    save: async (fw) => (await store).save(fw),
    load: async (fw) => (await store).load(fw),
    close: async () => (await store).close?.(),
  };
}

/** Build firewall + gateway from a config file and environment variables. Fails closed on bad config. */
export function bootFromEnv(env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = (m) => console.error(m)): Booted {
  const cfg = (env['PAYREKHA_CONFIG'] !== undefined ? readJson(env['PAYREKHA_CONFIG']) : {}) as PayrekhaFileConfig;
  const adminKey = env['PAYREKHA_ADMIN_KEY'];
  if (adminKey !== undefined && adminKey.length < 16) throw new Error('PAYREKHA_ADMIN_KEY must be at least 16 chars');
  const apiKeys = parseApiKeys(env['PAYREKHA_API_KEYS'] ?? '');
  if (apiKeys.length === 0) throw new Error('PAYREKHA_API_KEYS is required (id:prod|nonprod[:role+role]:token,…)');
  const scope = cfg.gateway?.merchantScope ?? {};
  for (const [keyId] of Object.entries(scope)) {
    if (!apiKeys.some((k) => k.id === keyId)) throw new Error(`gateway.merchantScope names unknown key '${keyId}'`);
  }
  const scopedKeys = apiKeys.map((k) => {
    const mids = scope[k.id];
    return mids === undefined ? k : { ...k, merchantIds: mids };
  });
  const hashKey = env['PAYREKHA_HASH_KEY'];
  const holidays = cfg.calendarFile !== undefined ? ((readJson(cfg.calendarFile) as { holidays?: [] }).holidays ?? []) : [];
  const fwCfg: FirewallConfig = {
    ...cfg.firewall,
    calendar: { ...cfg.firewall?.calendar, holidays: [...(cfg.firewall?.calendar?.holidays ?? []), ...holidays] },
    ...(adminKey !== undefined ? { adminTokenSha256: sha(adminKey) } : {}),
  };
  const set = payrekhaRules(cfg.rules ?? {});
  if (cfg.feedSnapshot !== undefined) set.feed.load(readJson(cfg.feedSnapshot), hashKey);
  for (const k of cfg.issuers ?? []) if (k.alg === 'hmac-sha256') log(`warning: issuer key ${k.keyId} is HMAC — whoever holds the secret can mint intents. Prefer ed25519.`);
  const secrets = (cfg.issuers ?? []).map((k) => (k.alg === 'hmac-sha256' && k.secret === undefined ? { ...k, secret: env[`PAYREKHA_ISSUER_SECRET_${k.keyId.replace(/\W/g, '_').toUpperCase()}`] ?? '' } : k));
  const webhook =
    env['PAYREKHA_WEBHOOK_URL'] !== undefined ? new WebhookSender({ url: env['PAYREKHA_WEBHOOK_URL'], secret: env['PAYREKHA_WEBHOOK_SECRET'] ?? '' }) : undefined;
  if (webhook !== undefined && (env['PAYREKHA_WEBHOOK_SECRET'] ?? '').length < 16) throw new Error('PAYREKHA_WEBHOOK_SECRET (≥ 16 chars) is required with PAYREKHA_WEBHOOK_URL');
  const fmt = env['PAYREKHA_LOG_FORMAT'] === 'cef' ? 'cef' : 'jsonl';
  const decisionLog =
    env['PAYREKHA_DECISION_LOG'] !== undefined
      ? fileDecisionLog(env['PAYREKHA_DECISION_LOG'], fmt, (e) => log(`decision-log stream error: ${e instanceof Error ? e.message : String(e)}`))
      : undefined;
  const firewall = new Payrekha(set.rules, {
    config: fwCfg,
    keys: secrets,
    onAlertChange: (_from, to, e) => webhook?.send({ type: to === 'HIGH_ALERT' ? 'alert.entered' : 'alert.cleared', atMs: e.atMs, actor: e.actor, reason: e.reason }),
    // Admin actions and denied/issued outcome reports must reach the SIEM.
    ...(decisionLog !== undefined ? { onAudit: (e) => decisionLog.write(auditRecord(e)) } : {}),
  });
  const pgUrl = env['PAYREKHA_STATE_PG_URL'];
  if (pgUrl !== undefined && env['PAYREKHA_STATE_FILE'] !== undefined) throw new Error('set PAYREKHA_STATE_FILE or PAYREKHA_STATE_PG_URL, not both');
  const stateKey = env['PAYREKHA_STATE_KEY'];
  if (stateKey !== undefined && stateKey.length < 32) throw new Error('PAYREKHA_STATE_KEY must be at least 32 chars');
  const prevKeys = (env['PAYREKHA_STATE_KEY_PREVIOUS'] ?? '').split(',').map((k) => k.trim()).filter((k) => k !== '');
  if (prevKeys.length > 0 && stateKey === undefined) throw new Error('PAYREKHA_STATE_KEY_PREVIOUS requires PAYREKHA_STATE_KEY');
  const stateStore: StateStore | undefined =
    pgUrl !== undefined
      ? postgresStore(pgUrl, env['PAYREKHA_STATE_PG_TABLE'], env['PAYREKHA_STATE_NAME'], stateKey, prevKeys)
      : env['PAYREKHA_STATE_FILE'] !== undefined
        ? new FileStateStore(env['PAYREKHA_STATE_FILE'], stateKey, prevKeys)
        : undefined;
  const extKey = env['PAYREKHA_EXT_AUTHZ_KEY'];
  const extAuthz = cfg.extAuthz !== undefined ? { ...cfg.extAuthz, ...(extKey !== undefined ? { keySha256: sha(extKey) } : {}) } : undefined;
  if (extAuthz !== undefined) {
    // The caller must never name its own source key: body/query sources are
    // client-controlled entirely. Header sources are only safe when Envoy
    // asserts the value — warn so a plain forward config can't slip through.
    const sks = cfg.extAuthz?.mapping?.sourceKeyId;
    if (typeof sks === 'string' && (sks.startsWith('body.') || sks.startsWith('query.')))
      throw new Error('extAuthz.mapping.sourceKeyId must not read from the request body or query — the caller would name its own key');
    if (typeof sks === 'string' && sks.startsWith('header.'))
      log('warning: extAuthz sourceKeyId comes from a header — the asserting proxy must set it; a forwarded client value defeats key binding');
    if (extAuthz.keySha256 === undefined)
      log('warning: ext_authz has no key (PAYREKHA_EXT_AUTHZ_KEY or extAuthz.keySha256) — anyone who can reach this port can evaluate payouts and spend intents under sourceKeyId "ext_authz"');
  }
  // Managed intents: the gateway holds a signing key so an adopter needs only
  // POST /v1/intents/mint. Probe it at boot — a private key that does not match
  // the keyring entry must fail startup, not the first real mint.
  const mintKeyId = env['PAYREKHA_MINT_KEY_ID'] ?? cfg.gateway?.mint?.keyId;
  const mintSecret = env['PAYREKHA_MINT_KEY'];
  let mint: { keyId: string; key: SignerKey; defaultTtlMs: number; maxTtlMs: number } | undefined;
  if (mintKeyId !== undefined || mintSecret !== undefined) {
    if (mintKeyId === undefined || mintSecret === undefined || mintSecret === '')
      throw new Error('managed intents need both PAYREKHA_MINT_KEY_ID and PAYREKHA_MINT_KEY (pkcs8 base64 or PEM)');
    const meta = firewall.keyring.list().find((k) => k.keyId === mintKeyId);
    if (meta === undefined) throw new Error(`PAYREKHA_MINT_KEY_ID '${mintKeyId}' is not a configured issuer key`);
    if (meta.alg !== 'ed25519') throw new Error(`mint key '${mintKeyId}' must be ed25519 — managed intents are only as strong as their key`);
    mint = {
      keyId: mintKeyId,
      key: { alg: 'ed25519', privateKey: mintSecret },
      defaultTtlMs: cfg.gateway?.mint?.defaultTtlMs ?? 300_000,
      maxTtlMs: cfg.gateway?.mint?.maxTtlMs ?? 86_400_000,
    };
    const probe = signIntent(
      {
        intentId: '__mint_probe__',
        kind: meta.kinds[0] ?? 'VERIFICATION',
        maxAmountPaise: 1,
        beneficiaryRef: 'probe',
        maxUses: 1,
        notBeforeMs: 0,
        expiresAtMs: Number.MAX_SAFE_INTEGER,
        issuer: meta.issuer,
        keyId: mintKeyId,
      },
      mint.key,
    );
    if (!firewall.keyring.verify(probe, Date.now()).ok) throw new Error(`PAYREKHA_MINT_KEY does not verify against issuer key '${mintKeyId}'`);
    log(`warning: managed intents enabled (keyId '${mintKeyId}') — this host can mint intents. Prefer externally-signed intents in enforce mode; see docs/adoption.md`);
  }
  const gateway = createGateway({
    firewall,
    apiKeys: scopedKeys,
    ...(adminKey !== undefined ? { adminKeySha256: sha(adminKey) } : {}),
    ...(hashKey !== undefined ? { hashKey } : {}),
    ...(decisionLog !== undefined ? { decisionLog } : {}),
    ...(mint !== undefined ? { mint } : {}),
    ...(cfg.gateway?.trustClientTimestamp === true ? { trustClientTimestamp: true } : {}),
    ...(webhook !== undefined ? { webhook } : {}),
    ...(extAuthz !== undefined ? { extAuthz } : {}),
    ...(stateStore !== undefined ? { stateStore } : {}),
    onError: (where, e) => log(`payrekha ${where}: ${e instanceof Error ? e.message : String(e)}`),
  });
  let stateLoaded: Promise<void> = Promise.resolve();
  if (stateStore !== undefined) {
    // Fail closed: until the snapshot is read we might be hiding a HIGH_ALERT, so serve 503 and keep retrying.
    gateway.setReady(false, 'loading state');
    const retryMs = envInt(env, 'PAYREKHA_STATE_RETRY_MS', 5_000);
    const attempt = async (): Promise<void> => {
      try {
        if (await stateStore.load(firewall)) log(`state restored from ${stateStore.describe} (alert: ${firewall.alertState})`);
        gateway.setReady(true);
      } catch (e) {
        gateway.setReady(false, 'state unreadable');
        log(`state ${stateStore.describe} unreadable — gateway NOT ready, retrying in ${retryMs} ms: ${e instanceof Error ? e.message : String(e)}`);
        setTimeout(() => void attempt(), retryMs).unref();
      }
    };
    stateLoaded = attempt();
  }
  return { firewall, gateway, feed: set.feed, config: cfg, ...(stateStore !== undefined ? { stateStore } : {}), stateLoaded };
}
