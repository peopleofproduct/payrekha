// Dry-run the ext_authz field mapping against a REAL payout sample — before
// traffic flows. Shows what PayRekha will extract from your payout JSON,
// what it can't find, and which mapping path to change.
//
//   node scripts/check-mapping.mjs --file sample-payout.json
//   node scripts/check-mapping.mjs --json '{"request_id":"r1","amount_in_paise":5000}' \
//       --mapping deploy/quickstart/payrekha.shadow.json \
//       --headers "x-payout-kind=LOAN_DISBURSAL,x-client-id=los-core"
//
// Defaults to the quickstart mapping. Prints per-field resolution plus the
// leaf paths your sample actually contains, so remapping is a 2-minute job.
import { readFileSync } from 'node:fs';
import { mapPayout, readPath } from '../packages/gateway/dist/mapping.js';
import { hashBeneficiary } from '../packages/core/dist/index.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const mappingFile = flag('--mapping', 'deploy/quickstart/payrekha.shadow.json');
const mappingCfg = JSON.parse(readFileSync(mappingFile, 'utf8'));
const mapping = mappingCfg.extAuthz?.mapping;
if (mapping === undefined) {
  console.error(`${mappingFile} has no extAuthz.mapping`);
  process.exit(2);
}

let sample;
if (args.includes('--file')) sample = JSON.parse(readFileSync(flag('--file'), 'utf8'));
else if (args.includes('--json')) sample = JSON.parse(flag('--json'));
else if (!process.stdin.isTTY) sample = JSON.parse(readFileSync(0, 'utf8'));
else { console.error('usage: --file sample.json | --json {...} | sample on stdin'); process.exit(2); }

const headers = Object.fromEntries(
  String(flag('--headers', '')).split(',').filter(Boolean).map((kv) => {
    const i = kv.indexOf('=');
    return [kv.slice(0, i).trim().toLowerCase(), kv.slice(i + 1).trim()];
  }),
);

const req = { path: '/payouts', headers, query: {}, body: sample };
const out = mapPayout(req, mapping, 'check-mapping-hash-key-0123456789abcdef', {
  origin: 'prod', sourceKeyId: 'check', nowMs: Date.now(),
});

const REQUIRED = ['payoutId', 'kind', 'amountPaise', 'channel', 'beneficiaryRef'];
const rows = [];
for (const [field, src] of Object.entries(mapping)) {
  if (field === 'beneficiary' && typeof src === 'object' && src !== null) {
    const label = Object.entries(src).map(([k, v]) => `${k}←${String(v)}`).join('  ');
    rows.push({ field: 'beneficiary', label, value: out.beneficiaryRef !== undefined ? '<hashed → beneficiaryRef>' : undefined, required: true });
    continue;
  }
  const spec = typeof src === 'object' && src !== null ? src : undefined;
  const label = spec !== undefined ? `const ${JSON.stringify(spec.const)}` : String(src);
  rows.push({ field, label, value: out[field], required: REQUIRED.includes(field) });
}

console.log(`\nMapping: ${mappingFile}\n`);
let missing = 0;
for (const r of rows) {
  const found = r.value !== undefined;
  if (!found && r.required) missing += 1;
  const mark = found ? ' ok ' : r.required ? 'MISS' : ' -- ';
  console.log(`${mark}  ${r.field.padEnd(20)} ← ${r.label.padEnd(52)} ${found ? `= ${JSON.stringify(r.value)}` : ''}`);
}
// (beneficiaryRef's required-ness is carried by the beneficiary row above —
// every other REQUIRED field maps 1:1 to its own row.)

// Flatten the sample's leaf paths so the remap is obvious.
const leaves = [];
const walk = (v, p) => {
  if (v === null || typeof v !== 'object') { leaves.push(`${p} = ${JSON.stringify(v)}`); return; }
  for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
};
if (sample !== null && typeof sample === 'object') walk(sample, 'body');
console.log('\nYour sample contains these paths (use any of them on the right of a mapping entry):');
for (const l of leaves.slice(0, 40)) console.log(`  ${l}`);
if (leaves.length > 40) console.log(`  … ${leaves.length - 40} more`);
console.log('  header.<name>  (headers passed via --headers)');

// If beneficiary mapped but didn't hash, explain why (account needs ifsc,
// formats are validated before hashing — same behaviour as the live adapter).
if (out.beneficiaryRef === undefined && typeof mapping.beneficiary === 'object' && mapping.beneficiary !== null) {
  const raw = {};
  for (const [k, s] of Object.entries(mapping.beneficiary)) {
    const v = readPath(req, String(s));
    if (v !== undefined) raw[k] = v;
  }
  console.log(`\nBeneficiary raw fields resolved: ${JSON.stringify(raw)}`);
  try {
    const id = raw.account !== undefined && raw.ifsc !== undefined ? { account: String(raw.account), ifsc: String(raw.ifsc) }
      : raw.vpa !== undefined ? { vpa: String(raw.vpa) }
      : raw.mobile !== undefined ? { mobile: String(raw.mobile) }
      : raw.address !== undefined && raw.network !== undefined ? { address: String(raw.address), network: String(raw.network) } : undefined;
    if (id === undefined) console.log('  → need account+ifsc together, a vpa, a mobile, or address+network (crypto) — none fully resolved');
    else { hashBeneficiary(id, 'check-mapping-hash-key-0123456789abcdef'); }
  } catch (e) {
    console.log(`  → rejected by format validation: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(missing === 0
  ? '\nAll required fields resolve — this mapping fits your payload.'
  : `\n${missing} required field(s) unmapped → those payouts would arrive degraded (REVIEW, not your rules). Fix the mapping lines marked MISS.`);
process.exit(missing === 0 ? 0 : 1);
