// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FileStateStore, Payrekha, type FirewallConfig, type IssuerKey } from '@payrekha/core';
import { payrekhaRules, type RulesConfig } from '@payrekha/rules';
import { fileDecisionLog } from './log.js';
import { createGateway, type ApiKey, type ExtAuthzOptions, type GatewayHandle } from './server.js';
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
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

/** `id:origin:token,…` → hashed ApiKey list. Tokens are hashed immediately and never kept. */
export function parseApiKeys(spec: string): ApiKey[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, origin, ...rest] = s.split(':');
      const token = rest.join(':');
      if (id === undefined || (origin !== 'prod' && origin !== 'nonprod') || token.length < 16) throw new Error('PAYREKHA_API_KEYS entries are id:prod|nonprod:token (token ≥ 16 chars)');
      return { id, origin, sha256: sha(token) };
    });
}

export interface Booted {
  readonly firewall: Payrekha;
  readonly gateway: GatewayHandle;
  readonly feed: ReturnType<typeof payrekhaRules>['feed'];
  readonly config: PayrekhaFileConfig;
}

/** Build firewall + gateway from a config file and environment variables. Fails closed on bad config. */
export function bootFromEnv(env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = (m) => console.error(m)): Booted {
  const cfg = (env['PAYREKHA_CONFIG'] !== undefined ? readJson(env['PAYREKHA_CONFIG']) : {}) as PayrekhaFileConfig;
  const adminKey = env['PAYREKHA_ADMIN_KEY'];
  if (adminKey !== undefined && adminKey.length < 16) throw new Error('PAYREKHA_ADMIN_KEY must be at least 16 chars');
  const apiKeys = parseApiKeys(env['PAYREKHA_API_KEYS'] ?? '');
  if (apiKeys.length === 0) throw new Error('PAYREKHA_API_KEYS is required (id:prod|nonprod:token,…)');
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
  const firewall = new Payrekha(set.rules, {
    config: fwCfg,
    keys: secrets,
    onAlertChange: (_from, to, e) => webhook?.send({ type: to === 'HIGH_ALERT' ? 'alert.entered' : 'alert.cleared', atMs: e.atMs, actor: e.actor, reason: e.reason }),
  });
  const stateStore = env['PAYREKHA_STATE_FILE'] !== undefined ? new FileStateStore(env['PAYREKHA_STATE_FILE']) : undefined;
  const fmt = env['PAYREKHA_LOG_FORMAT'] === 'cef' ? 'cef' : 'jsonl';
  const extKey = env['PAYREKHA_EXT_AUTHZ_KEY'];
  const extAuthz = cfg.extAuthz !== undefined ? { ...cfg.extAuthz, ...(extKey !== undefined ? { keySha256: sha(extKey) } : {}) } : undefined;
  const gateway = createGateway({
    firewall,
    apiKeys,
    ...(adminKey !== undefined ? { adminKeySha256: sha(adminKey) } : {}),
    ...(hashKey !== undefined ? { hashKey } : {}),
    ...(env['PAYREKHA_DECISION_LOG'] !== undefined ? { decisionLog: fileDecisionLog(env['PAYREKHA_DECISION_LOG'], fmt) } : {}),
    ...(webhook !== undefined ? { webhook } : {}),
    ...(extAuthz !== undefined ? { extAuthz } : {}),
    ...(stateStore !== undefined ? { stateStore } : {}),
    onError: (where, e) => log(`payrekha ${where}: ${e instanceof Error ? e.message : String(e)}`),
  });
  if (stateStore !== undefined) {
    try {
      if (stateStore.load(firewall)) log(`state restored from ${stateStore.path} (alert: ${firewall.alertState})`);
    } catch (e) {
      // Fail closed: a corrupt snapshot might be hiding a HIGH_ALERT. Stay unready until an operator looks.
      gateway.setReady(false, 'state file unreadable');
      log(`state file unreadable — gateway NOT ready: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { firewall, gateway, feed: set.feed, config: cfg };
}
