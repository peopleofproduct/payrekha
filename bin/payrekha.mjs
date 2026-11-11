#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// payrekha init — pick your segment, get a working shadow stack:
//   payrekha.json (kit thresholds) · docker-compose.yml · envoy.yaml ·
//   .env (generated secrets) · issuer Ed25519 keypair · calendar ·
//   prometheus.yml · README-NEXT.md
//
//   node bin/payrekha.mjs init                      # interactive
//   node bin/payrekha.mjs init --segment lender --out ./payrekha-stack --yes
//   npx payrekha init                               # once published
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEGMENTS = ['lender', 'pa', 'psp', 'crypto'];
// The payout-service key id the segment's traffic asserts — matches each
// kit's dominant source_key_id so velocity budgets line up.
const SOURCE_KEYS = { lender: 'lms-prod', pa: 'settlement-svc', psp: 'refund-api', crypto: 'withdrawal-api' };

const args = process.argv.slice(2);
if (args[0] !== 'init') {
  console.error(`payrekha — the payout firewall

  payrekha init            generate a shadow stack for your segment

Flags: --segment lender|pa|psp|crypto --out DIR --tier external|mint --yes`);
  process.exit(args[0] === '--help' || args[0] === '-h' ? 0 : 2);
}
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const rl = process.stdout.isTTY && !args.includes('--yes') ? createInterface({ input: process.stdin, output: process.stdout }) : null;
const ask = (q, def) =>
  rl === null
    ? Promise.resolve(def)
    : new Promise((r) => rl.question(`${q} ${def !== undefined ? `[${def}] ` : ''}`, (a) => r(a.trim() || def)));

const segment = await ask(`Segment? ${SEGMENTS.join('/')}`, flag('segment', 'lender'));
if (!SEGMENTS.includes(segment)) {
  console.error(`unknown segment '${segment}' — pick ${SEGMENTS.join(', ')}`);
  process.exit(2);
}
const tier = await ask(
  'Intent signing tier? external (sign in your SoR — recommended) / mint (gateway-managed, pilot)',
  flag('tier', 'external'),
);
if (!['external', 'mint'].includes(tier)) {
  console.error("tier must be 'external' or 'mint'");
  process.exit(2);
}
const out = await ask('Output directory?', flag('out', './payrekha-stack'));
rl?.close();

if (existsSync(join(out, 'payrekha.json'))) {
  console.error(`${out}/payrekha.json already exists — refusing to overwrite a stack`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const put = (name, content, mode) => {
  writeFileSync(join(out, name), content);
  if (mode !== undefined) chmodSync(join(out, name), mode);
};

// --- issuer keypair(s) -------------------------------------------------------
// Crypto (and any m-of-n segment) needs one keypair PER approver issuer — the
// requiredApprovals check only counts distinct issuers. Segments without an
// approverIssuers list get the segment's own signer.
const kit0 = JSON.parse(read(`kits/${segment}/payrekha.json`));
const approvers = kit0.firewall?.requiredApprovals
  ? [...new Set(Object.values(kit0.firewall.requiredApprovals).flatMap((r) => (typeof r === 'object' ? (r.approverIssuers ?? []) : [])))]
  : [];
const issuerNames = approvers.length > 0 ? approvers : [`${segment}-prod`];
const mkPair = () => {
  const kp = generateKeyPairSync('ed25519');
  return {
    pub: kp.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    priv: kp.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
};
const issuers = issuerNames.map((name) => {
  const { pub, priv } = mkPair();
  return { name, keyId: `${name.replace(/-prod$/, '')}-2026-01`, pub, priv };
});
const issuerKeyId = issuers[0].keyId;
const priv = issuers[0].priv;

// --- payrekha.json: kit rules/firewall + gateway surface --------------------
const kit = kit0;
const shadow = JSON.parse(read('deploy/quickstart/payrekha.shadow.json'));
// The issuer entry (public key) is the same either way — 'external' signs in
// the SoR with the private key, 'mint' hands it to the gateway for managed
// signing. kinds = the kinds this segment's flow actually mints.
const ALL_KINDS = ['LOAN_DISBURSAL', 'PA_SETTLEMENT', 'REFUND', 'VDA_WITHDRAWAL', 'VENDOR_PAYOUT', 'VERIFICATION'];
const req = kit.firewall?.requireIntent ?? {};
// requireIntent defaults to require-all — kinds = everything not opted out.
const kinds = ALL_KINDS.filter((k) => req[k] !== false);
const config = {
  ...kit,
  calendarFile: '/etc/payrekha/calendar.json',
  issuers: issuers.map((s) => ({ keyId: s.keyId, issuer: s.name, alg: 'ed25519', publicKey: s.pub, kinds })),
  extAuthz: shadow.extAuthz,
  ...(tier === 'mint' ? { gateway: { mint: { keyId: issuerKeyId, mintsPerMinute: 30, modes: ['shadow', 'advise'] } } } : {}),
};

put('payrekha.json', JSON.stringify(config, null, 2) + '\n');
put('calendar.json', read('config/calendars/india-2026.example.json'));
put('envoy.yaml', read('deploy/quickstart/envoy.yaml'));
put('prometheus.yml', read('deploy/quickstart/prometheus.yml').replace('REPLACE_WITH_READ_KEY', '${PAYREKHA_READ_KEY}'));

// --- docker-compose (quickstart shape, generated-file mounts) ---------------
put(
  'docker-compose.yml',
  `# Generated by payrekha init — ${segment} kit, SHADOW posture.
# docker compose up -d   →  envoy :10000 · gateway :8080 · prometheus :9090
services:
  payrekha:
    image: ghcr.io/peopleofproduct/payrekha:latest
    read_only: true
    security_opt: ['no-new-privileges:true']
    cap_drop: [ALL]
    environment:
      PAYREKHA_API_KEYS: \${PAYREKHA_API_KEYS}
      PAYREKHA_ADMIN_KEY: \${PAYREKHA_ADMIN_KEY}
      PAYREKHA_HASH_KEY: \${PAYREKHA_HASH_KEY}
      PAYREKHA_STATE_KEY: \${PAYREKHA_STATE_KEY}
      PAYREKHA_EXT_AUTHZ_KEY: \${PAYREKHA_EXT_AUTHZ_KEY}
${tier === 'mint' ? '      PAYREKHA_MINT_KEY_ID: ' + issuerKeyId + '\n      PAYREKHA_MINT_KEY: ${PAYREKHA_MINT_KEY}\n' : ''}      PAYREKHA_CONFIG: /etc/payrekha/payrekha.json
      PAYREKHA_STATE_FILE: /var/lib/payrekha/state.json
      PAYREKHA_DECISION_LOG: /var/lib/payrekha/decisions.jsonl
    volumes:
      - ./payrekha.json:/etc/payrekha/payrekha.json:ro
      - ./calendar.json:/etc/payrekha/calendar.json:ro
      - payrekha-data:/var/lib/payrekha
    ports: ['8080:8080']
  envoy:
    image: envoyproxy/envoy:v1.31-latest
    volumes: ['./envoy.yaml:/etc/envoy/envoy.yaml:ro']
    ports: ['10000:10000']
    depends_on: [payrekha]
  prometheus:
    image: prom/prometheus:v2.55.1
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
    ports: ['9090:9090']
volumes: { payrekha-data: {} }
`,
);

// --- secrets ----------------------------------------------------------------
const hex = () => randomBytes(24).toString('hex');
const evalKey = hex(),
  readKey = hex(),
  adminKey = hex(),
  hashKey = hex(),
  stateKey = hex(),
  extKey = hex();
const SOURCE_KEY = SOURCE_KEYS[segment];
put(
  '.env',
  `# Generated by payrekha init — chmod 600, never commit.
PAYREKHA_EVALUATE_KEY=${evalKey}
PAYREKHA_READ_KEY=${readKey}
PAYREKHA_ADMIN_KEY=${adminKey}
PAYREKHA_HASH_KEY=${hashKey}
PAYREKHA_STATE_KEY=${stateKey}
PAYREKHA_EXT_AUTHZ_KEY=${extKey}
${tier === 'mint' ? `PAYREKHA_MINT_KEY=${priv}\n` : ''}PAYREKHA_API_KEYS=${SOURCE_KEY}:prod:evaluate:${evalKey},soc-reader:prod:read:${readKey}
`,
  0o600,
);

// --- issuer key material ----------------------------------------------------
put(
  'issuer-keys.json',
  JSON.stringify(
    {
      note: "PRIVATE KEYS — one per issuer. Store each in its owner's secret manager / KMS (trading engine ≠ risk desk), then delete this file.",
      issuers: issuers.map((s) => ({ keyId: s.keyId, issuer: s.name, alg: 'ed25519', publicKey: s.pub, privateKey: s.priv })),
    },
    null,
    2,
  ) + '\n',
  0o600,
);

// --- README-NEXT -------------------------------------------------------------
put(
  'README-NEXT.md',
  `# payrekha init — ${segment} stack

Generated: ${new Date().toISOString()}

## What you got
- \`payrekha.json\` — ${segment} kit thresholds (see kits/${segment}/README.md
  for the rationale), \`issuers[]\` pre-filled with your generated public key.
- \`docker-compose.yml\` — gateway + Envoy ext_authz + Prometheus. Shadow mode:
  observes, never blocks.
- \`.env\` (chmod 600) — all secrets generated fresh. Move to your secret
  manager before anything real.
- \`issuer-keys.json\` — your Ed25519 keypair. The private key signs intents
  in YOUR system of record${tier === 'mint' ? ' (or feeds PAYREKHA_MINT_KEY for managed minting)' : ''}.

## Run
\`\`\`bash
cd ${out}
docker compose --env-file .env up -d
curl localhost:8080/readyz                      # → {"ok":true,…}
\`\`\`

## Next steps
1. Route a payout through Envoy: \`curl -X POST localhost:10000/payouts …\`
   — it evaluates in shadow; watch the decision log:
   \`docker exec <payrekha> tail -f /var/lib/payrekha/decisions.jsonl\`
2. Edit the two marked spots in \`envoy.yaml\`: your payout upstream +
   \`x-client-id\` = your payout service id.
3. Edit \`extAuthz.mapping\` in \`payrekha.json\` to your payout JSON shape
   (docs/integrations/envoy.md).
4. ${tier === 'external' ? 'Sign intents in your SoR — see clients/js, clients/java, docs/kms.md.' : 'Mint managed intents — POST /v1/intents/mint with a mint-role key. Plan the move to external signing (docs/adoption.md).'}
5. Replay your own month: \`npm run replay -- --payouts yours.csv …\` →
   tune thresholds, then flip \`firewall.mode\` to \`enforce\`.

## Rotate
All secrets are single-file. To rotate: regenerate .env, update the api
caller, \`docker compose up -d\`. The issuer key rotates via a second
\`issuers[]\` entry — overlap, then revoke the old keyId.
`,
);

console.log(`✓ ${out}/ — ${segment} shadow stack generated
  payrekha.json   ${segment} thresholds + issuer ${issuerKeyId}
  docker-compose  gateway + envoy + prometheus (shadow)
  .env            fresh secrets (chmod 600)
  issuer-keys     Ed25519 pair — private key is yours alone
→ cd ${out} && docker compose --env-file .env up -d`);
