// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FileStateStore, Payrekha, type FirewallConfig, type IssuerKey, type StateStore } from '@payrekha/core';
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
  readonly gateway?: { readonly trustClientTimestamp?: boolean };
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

export interface Booted {
  readonly firewall: Payrekha;
  readonly gateway: GatewayHandle;
  readonly feed: ReturnType<typeof payrekhaRules>['feed'];
  readonly config: PayrekhaFileConfig;
  readonly stateStore?: StateStore;
  /** Settles after the first state-load attempt. The gateway stays unready (503) until a load succeeds. */
  readonly stateLoaded: Promise<void>;
}

type PgStoreCtor = new (o: { connectionString: string; table?: string; name?: string }) => StateStore;

/** Postgres support is a separate package so the gateway itself never depends on a DB driver. */
function postgresStore(url: string, table: string | undefined, name: string | undefined): StateStore {
  const spec = '@payrekha/store-postgres';
  const store: Promise<StateStore> = import(spec).then(
    (m: { PostgresStateStore: PgStoreCtor }) => new m.PostgresStateStore({ connectionString: url, ...(table !== undefined ? { table } : {}), ...(name !== undefined ? { name } : {}) }),
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
  const decisionLog = env['PAYREKHA_DECISION_LOG'] !== undefined ? fileDecisionLog(env['PAYREKHA_DECISION_LOG'], fmt) : undefined;
  const firewall = new Payrekha(set.rules, {
    config: fwCfg,
    keys: secrets,
    onAlertChange: (_from, to, e) => webhook?.send({ type: to === 'HIGH_ALERT' ? 'alert.entered' : 'alert.cleared', atMs: e.atMs, actor: e.actor, reason: e.reason }),
    // Admin actions and denied/issued outcome reports must reach the SIEM.
    ...(decisionLog !== undefined ? { onAudit: (e) => decisionLog.write(auditRecord(e)) } : {}),
  });
  const pgUrl = env['PAYREKHA_STATE_PG_URL'];
  if (pgUrl !== undefined && env['PAYREKHA_STATE_FILE'] !== undefined) throw new Error('set PAYREKHA_STATE_FILE or PAYREKHA_STATE_PG_URL, not both');
  const stateStore: StateStore | undefined =
    pgUrl !== undefined
      ? postgresStore(pgUrl, env['PAYREKHA_STATE_PG_TABLE'], env['PAYREKHA_STATE_NAME'])
      : env['PAYREKHA_STATE_FILE'] !== undefined
        ? new FileStateStore(env['PAYREKHA_STATE_FILE'])
        : undefined;
  const extKey = env['PAYREKHA_EXT_AUTHZ_KEY'];
  const extAuthz = cfg.extAuthz !== undefined ? { ...cfg.extAuthz, ...(extKey !== undefined ? { keySha256: sha(extKey) } : {}) } : undefined;
  const gateway = createGateway({
    firewall,
    apiKeys,
    ...(adminKey !== undefined ? { adminKeySha256: sha(adminKey) } : {}),
    ...(hashKey !== undefined ? { hashKey } : {}),
    ...(decisionLog !== undefined ? { decisionLog } : {}),
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
    const retryMs = Number(env['PAYREKHA_STATE_RETRY_MS'] ?? 5_000);
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
