// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 — People of Product™
//
// Operator mule/suspect CSV → feed snapshot for `feedSnapshot` in payrekha.json
// (consumed by `feed.reputation`). Raw identifiers never survive: every entry
// becomes an hb1_ ref hashed with your PayRekha hash key.
//
//   node scripts/csv-to-feed-snapshot.mjs --in mules.csv --source i4c-cfcfrms > feed-snapshot.json
//   node scripts/csv-to-feed-snapshot.mjs --in refs.csv                 # rows that are all kind=ref need no key
//
// CSV columns (header row required):
//   kind    mobile | vpa | account | address | ref
//   value   the identifier: account number (kind=account), wallet address
//           (kind=address), or an already-hashed hb1_… value (kind=ref)
//   aux     IFSC when kind=account, network when kind=address, else empty
//   band    LOW | MEDIUM | HIGH | VERY_HIGH
//   source  optional per-row attribution (falls back to --source)
//
// Hash key: --hash-key or $PAYREKHA_HASH_KEY. Requires `npm run build` first.
import { readFileSync } from 'node:fs';
import { hashBeneficiary } from '../packages/core/dist/index.js';
import { parseCsv } from '../packages/replay/dist/csv.js';

const BANDS = new Set(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']);
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
if (args.includes('--help') || flag('in') === undefined) {
  console.error('usage: csv-to-feed-snapshot.mjs --in list.csv [--hash-key K] [--source NAME]');
  process.exit(flag('in') === undefined ? 1 : 0);
}

const input = flag('in');
const source = flag('source') ?? 'operator';
const hashKey = flag('hash-key') ?? process.env['PAYREKHA_HASH_KEY'];
const rows = parseCsv(readFileSync(input, 'utf8'));
const entries = [];
const problems = [];

rows.forEach((r, i) => {
  const at = `${input} row ${i + 2}`;
  const kind = (r['kind'] ?? '').toLowerCase();
  const value = r['value'] ?? '';
  const aux = r['aux'] ?? '';
  const band = (r['band'] ?? '').toUpperCase();
  if (value === '') return problems.push(`${at}: value is empty`);
  if (!BANDS.has(band)) return problems.push(`${at}: band '${r['band']}' is not LOW|MEDIUM|HIGH|VERY_HIGH`);
  const out = { band, ...(r['source'] ? { source: r['source'] } : {}) };
  if (kind === 'ref') {
    if (!value.startsWith('hb1_')) return problems.push(`${at}: kind=ref needs an hb1_… value, not a raw identifier`);
    return entries.push({ ...out, ref: value });
  }
  const id =
    kind === 'mobile'
      ? { mobile: value }
      : kind === 'vpa'
        ? { vpa: value }
        : kind === 'account'
          ? { account: value, ifsc: aux }
          : kind === 'address'
            ? { address: value, network: aux }
            : undefined;
  if (id === undefined) return problems.push(`${at}: kind '${r['kind']}' is not mobile|vpa|account|address|ref`);
  if ((kind === 'account' || kind === 'address') && aux === '') return problems.push(`${at}: kind=${kind} needs aux (IFSC / network)`);
  if (hashKey === undefined) return problems.push(`${at}: raw identifiers need --hash-key or PAYREKHA_HASH_KEY`);
  try {
    entries.push({ ...out, ref: hashBeneficiary(id, hashKey) });
  } catch (err) {
    problems.push(`${at}: ${err.message}`);
  }
});

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ version: 1, source, generatedAt: new Date().toISOString(), entries }, null, 2)}\n`);
console.error(`${entries.length} entries (${rows.length} rows${rows.length > entries.length ? `, ${rows.length - entries.length} duplicates collapsed` : ''}) — raw identifiers hashed, not written.`);
