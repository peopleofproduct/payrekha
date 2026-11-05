// CI guard: @payrekha/core has no dependencies; @payrekha/rules depends only on core.
import { readFileSync } from 'node:fs';
const allowed = { core: [], rules: ['@payrekha/core'] };
let bad = 0;
for (const [pkg, ok] of Object.entries(allowed)) {
  const j = JSON.parse(readFileSync(`packages/${pkg}/package.json`, 'utf8'));
  const deps = Object.keys({ ...j.dependencies, ...j.optionalDependencies, ...j.peerDependencies });
  const extra = deps.filter((d) => !ok.includes(d));
  if (extra.length > 0) {
    console.error(`@payrekha/${pkg} has runtime dependencies: ${extra.join(', ')}`);
    bad = 1;
  }
}
// Core and rules must never make network calls.
import { readdirSync } from 'node:fs';
for (const pkg of Object.keys(allowed))
  for (const f of readdirSync(`packages/${pkg}/src`)) {
    const src = readFileSync(`packages/${pkg}/src/${f}`, 'utf8');
    if (/from 'node:(http|https|net|dgram|tls|dns)'|\bfetch\(/.test(src)) {
      console.error(`packages/${pkg}/src/${f} imports a network module`);
      bad = 1;
    }
  }
if (bad === 0) console.log('core and rules: zero runtime dependencies, no network imports');
process.exit(bad);
