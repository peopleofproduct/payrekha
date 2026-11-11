// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FileStateStore, MemorySharedBackend, Payrekha, signIntent, INTENT_KINDS, type FirewallConfig, type IntentKind, type IssuerKey, type Mode, type SharedStateBackend, type StateStore } from '@payrekha/core';
import { payrekhaRules, type RulesConfig } from '@payrekha/rules';
import { auditRecord, fileDecisionLog } from './log.js';
import { API_ROLES, createGateway, type ApiKey, type ApiRole, type ExtAuthzOptions, type GatewayHandle, type GatewayOptions } from './server.js';
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
     * `maxAmountPaise`/`mintsPerMinute`/`modes` bound a stolen mint key.
     */
    readonly mint?: {
      readonly keyId?: string;
      readonly defaultTtlMs?: number;
      readonly maxTtlMs?: number;
      readonly maxAmountPaise?: number;
      readonly mintsPerMinute?: number;
      readonly modes?: readonly Mode[];
    };
    /**
     * ADR 0004 active-active shared state (backend comes from
     * PAYREKHA_SHARED_PG_URL; without it an in-memory backend is used —
     * single replica only, warned at boot). `commitPolicy` is the lender's
     * consistency knob: 'all' (default) or the IntentKinds that must commit.
     */
    readonly sharedState?: {
      readonly commitPolicy?: 'all' | readonly IntentKind[];
      readonly controlPollMs?: number;
      /** Settled reservation tombstone retention, e.g. 90 for days ×86400000 — purged hourly on the store clock. */
      readonly reservationRetentionDays?: number;
    };
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

type PgSharedCtor = new (o: { connectionString: string; tablePrefix?: string }) => SharedStateBackend;

/** Shared-state Postgres support is also optional — same lazy-import pattern as the snapshot store. */
function postgresShared(url: string, tablePrefix: string | undefined): SharedStateBackend {
  const spec = '@payrekha/store-postgres';
  const be: Promise<SharedStateBackend> = import(spec).then(
    (m: { PostgresSharedBackend: PgSharedCtor }) => new m.PostgresSharedBackend({ connectionString: url, ...(tablePrefix !== undefined ? { tablePrefix } : {}) }),
    () => {
      throw new Error('PAYREKHA_SHARED_PG_URL is set but @payrekha/store-postgres is not installed');
    },
  );
  be.catch(() => undefined);
  return {
    describe: `postgres:${tablePrefix ?? 'payrekha_sa'}`,
    putIntent: async (i) => (await be).putIntent(i),
    getIntent: async (id) => (await be).getIntent(id),
    commit: async (c) => (await be).commit(c),
    intentState: async (id) => (await be).intentState(id),
    releaseReservation: async (id, k) => (await be).releaseReservation(id, k),
    settleReservation: async (id, k) => (await be).settleReservation(id, k),
    readControl: async () => (await be).readControl(),
    writeControl: async (m) => (await be).writeControl(m),
    importIntent: async (r) => (await be).importIntent(r),
    importReservation: async (r) => (await be).importReservation(r),
    purgeReservations: async (ms) => (await be).purgeReservations(ms),
    reservationStats: async () => (await be).reservationStats(),
    close: async () => (await be).close?.(),
  };
}

/** Build firewall + gateway from a config file and environment variables. Fails closed on bad config. */
export function bootFromEnv(env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = (m) => console.error(m), opts?: Pick<GatewayOptions, 'consoleHtml'>): Booted {
  const cfg = (env['PAYREKHA_CONFIG'] !== undefined ? readJson(env['PAYREKHA_CONFIG']) : {}) as PayrekhaFileConfig;
  const adminKey = env['PAYREKHA_ADMIN_KEY'];
  if (adminKey !== undefined && adminKey.length < 16) throw new Error('PAYREKHA_ADMIN_KEY must be at least 16 chars');
  if (adminKey !== undefined && adminKey.length < 32) log('warning: PAYREKHA_ADMIN_KEY is under 32 chars — acceptable for trials; use ≥32 in production');
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
  if (webhook !== undefined && !env['PAYREKHA_WEBHOOK_URL']!.startsWith('https://'))
    log('warning: PAYREKHA_WEBHOOK_URL is not https — the HMAC signature protects integrity, but payloads travel in cleartext; use an https endpoint in regulated deployments');
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
    if (extAuthz.keySha256 === undefined && extAuthz.allowInsecure !== true)
      throw new Error('ext_authz has no key (PAYREKHA_EXT_AUTHZ_KEY or extAuthz.keySha256) — anyone who can reach this port could evaluate payouts and spend intents. On a genuinely isolated network set extAuthz.allowInsecure: true to acknowledge this');
    if (extAuthz.keySha256 === undefined) log('warning: ext_authz running unauthenticated (allowInsecure) — acceptable only on an isolated network');
  }
  // Managed intents: the gateway holds a signing key so an adopter needs only
  // POST /v1/intents/mint. Probe it at boot — a private key that does not match
  // the keyring entry must fail startup, not the first real mint.
  const mintKeyId = env['PAYREKHA_MINT_KEY_ID'] ?? cfg.gateway?.mint?.keyId;
  const mintSecret = env['PAYREKHA_MINT_KEY'];
  let mint: GatewayOptions['mint'];
  if (mintKeyId !== undefined || mintSecret !== undefined) {
    if (mintKeyId === undefined || mintSecret === undefined || mintSecret === '')
      throw new Error('managed intents need both PAYREKHA_MINT_KEY_ID and PAYREKHA_MINT_KEY (pkcs8 base64 or PEM)');
    const meta = firewall.keyring.list().find((k) => k.keyId === mintKeyId);
    if (meta === undefined) throw new Error(`PAYREKHA_MINT_KEY_ID '${mintKeyId}' is not a configured issuer key`);
    if (meta.alg !== 'ed25519') throw new Error(`mint key '${mintKeyId}' must be ed25519 — managed intents are only as strong as their key`);
    const mintModes = cfg.gateway?.mint?.modes;
    if (mintModes !== undefined && !mintModes.every((m) => m === 'shadow' || m === 'advise' || m === 'enforce')) throw new Error('gateway.mint.modes must be a subset of shadow|advise|enforce');
    if (cfg.gateway?.mint?.maxAmountPaise !== undefined && (!Number.isSafeInteger(cfg.gateway.mint.maxAmountPaise) || cfg.gateway.mint.maxAmountPaise <= 0)) throw new Error('gateway.mint.maxAmountPaise must be a positive integer');
    if (cfg.gateway?.mint?.mintsPerMinute !== undefined && (!Number.isSafeInteger(cfg.gateway.mint.mintsPerMinute) || cfg.gateway.mint.mintsPerMinute <= 0)) throw new Error('gateway.mint.mintsPerMinute must be a positive integer');
    mint = {
      keyId: mintKeyId,
      key: { alg: 'ed25519', privateKey: mintSecret },
      defaultTtlMs: cfg.gateway?.mint?.defaultTtlMs ?? 300_000,
      maxTtlMs: cfg.gateway?.mint?.maxTtlMs ?? 86_400_000,
      ...(cfg.gateway?.mint?.maxAmountPaise !== undefined ? { maxAmountPaise: cfg.gateway.mint.maxAmountPaise } : {}),
      ...(cfg.gateway?.mint?.mintsPerMinute !== undefined ? { mintsPerMinute: cfg.gateway.mint.mintsPerMinute } : {}),
      ...(mintModes !== undefined ? { modes: mintModes } : {}),
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
    if (mint.maxAmountPaise === undefined) log('warning: gateway.mint.maxAmountPaise unset — a stolen mint key can authorise any amount its issuer kinds allow');
    for (const k of scopedKeys) {
      const roles = k.roles ?? API_ROLES;
      if (roles.includes('mint') && (roles.includes('evaluate') || roles.includes('intents'))) log(`warning: API key '${k.id}' holds mint alongside evaluate/intents — split the roles so one stolen token cannot both authorise and execute`);
    }
  }
  const sharedCfg = cfg.gateway?.sharedState;
  const sharedPgUrl = env['PAYREKHA_SHARED_PG_URL'];
  let sharedState: GatewayOptions['sharedState'];
  if (sharedPgUrl !== undefined || sharedCfg !== undefined) {
    const policy = sharedCfg?.commitPolicy ?? 'all';
    if (policy !== 'all' && !policy.every((k) => INTENT_KINDS.includes(k))) throw new Error('gateway.sharedState.commitPolicy must be "all" or a list of IntentKinds');
    if (sharedCfg?.controlPollMs !== undefined && (!Number.isSafeInteger(sharedCfg.controlPollMs) || sharedCfg.controlPollMs < 100)) throw new Error('gateway.sharedState.controlPollMs must be an integer ≥ 100');
    const retentionDays = sharedCfg?.reservationRetentionDays;
    if (retentionDays !== undefined && (typeof retentionDays !== 'number' || !Number.isFinite(retentionDays) || retentionDays <= 0)) throw new Error('gateway.sharedState.reservationRetentionDays must be a positive number');
    const backend = sharedPgUrl !== undefined ? postgresShared(sharedPgUrl, env['PAYREKHA_SHARED_PG_PREFIX']) : new MemorySharedBackend();
    if (sharedPgUrl === undefined) log('warning: sharedState enabled without PAYREKHA_SHARED_PG_URL — in-memory backend: single replica only');
    sharedState = { backend, commitPolicy: policy, ...(sharedCfg?.controlPollMs !== undefined ? { controlPollMs: sharedCfg.controlPollMs } : {}), ...(retentionDays !== undefined ? { reservationRetentionMs: Math.round(retentionDays * 86_400_000) } : {}) };
    log(`shared state: ${backend.describe} (commitPolicy: ${policy === 'all' ? 'all' : policy.join(',')})`);
  }
  // Optional TLS on the listener itself — edge termination stays the
  // production default; this is defense-in-depth (or mTLS) inside the zone.
  const tlsKeyFile = env['PAYREKHA_TLS_KEY_FILE'];
  const tlsCertFile = env['PAYREKHA_TLS_CERT_FILE'];
  let tls: GatewayOptions['tls'];
  if (tlsKeyFile !== undefined || tlsCertFile !== undefined) {
    if (tlsKeyFile === undefined || tlsCertFile === undefined) throw new Error('PAYREKHA_TLS_KEY_FILE and PAYREKHA_TLS_CERT_FILE must be set together');
    const caFile = env['PAYREKHA_TLS_CA_FILE'];
    const clientAuth = env['PAYREKHA_TLS_CLIENT_AUTH'];
    const minVersion = env['PAYREKHA_TLS_MIN_VERSION'];
    if (clientAuth !== undefined && clientAuth !== 'optional' && clientAuth !== 'required') throw new Error("PAYREKHA_TLS_CLIENT_AUTH must be 'optional' or 'required'");
    if (clientAuth !== undefined && caFile === undefined) throw new Error('PAYREKHA_TLS_CLIENT_AUTH requires PAYREKHA_TLS_CA_FILE — the CA bundle that verifies client certificates');
    if (minVersion !== undefined && minVersion !== 'TLSv1.2' && minVersion !== 'TLSv1.3') throw new Error('PAYREKHA_TLS_MIN_VERSION must be TLSv1.2 or TLSv1.3');
    tls = {
      key: readFileSync(tlsKeyFile),
      cert: readFileSync(tlsCertFile),
      ...(caFile !== undefined ? { ca: readFileSync(caFile) } : {}),
      ...(clientAuth !== undefined ? { clientAuth: clientAuth as 'optional' | 'required' } : {}),
      ...(minVersion !== undefined ? { minVersion: minVersion as 'TLSv1.2' | 'TLSv1.3' } : {}),
    };
    log(`TLS on the gateway listener (min ${minVersion ?? 'TLSv1.2'}${clientAuth === 'required' ? ', client certificates required' : clientAuth === 'optional' ? ', client certificates optional' : ''})`);
  }
  const gateway = createGateway({
    firewall,
    apiKeys: scopedKeys,
    ...(adminKey !== undefined ? { adminKeySha256: sha(adminKey) } : {}),
    ...(tls !== undefined ? { tls } : {}),
    ...(hashKey !== undefined ? { hashKey } : {}),
    ...(decisionLog !== undefined ? { decisionLog } : {}),
    ...(mint !== undefined ? { mint } : {}),
    ...(cfg.gateway?.trustClientTimestamp === true ? { trustClientTimestamp: true } : {}),
    ...(webhook !== undefined ? { webhook } : {}),
    ...(extAuthz !== undefined ? { extAuthz } : {}),
    ...(stateStore !== undefined ? { stateStore } : {}),
    ...(sharedState !== undefined ? { sharedState } : {}),
    ...(opts?.consoleHtml !== undefined ? { consoleHtml: opts.consoleHtml } : {}),
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
