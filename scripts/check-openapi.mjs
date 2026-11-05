// Dependency-free contract check: every HTTP route the gateway serves must
// appear in docs/api/openapi.yaml and vice versa. Run in CI so the spec
// cannot silently drift from the implementation again.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(root, 'packages/gateway/src/server.ts'), 'utf8');
const openapi = readFileSync(join(root, 'docs/api/openapi.yaml'), 'utf8');

// Exact-match routes: `path === '/x'`.
const exact = [...server.matchAll(/path === '(\/[^']+)'/g)].map((m) => m[1]);
// Prefix routes: `path.startsWith('/x/')` → OpenAPI `{param}` path.
const prefix = [...server.matchAll(/path\.startsWith\('(\/[^']+)'\)/g)].map((m) => m[1]);
const toSpec = (p) =>
  p === '/v1/issuers/' ? '/v1/issuers/{keyId}'
    : p === '/v1/intents/' ? '/v1/intents/{intentId}'
      : p === '/ext_authz' ? '/ext_authz/{path}'
        : p;
const serverPaths = new Set([...exact, ...prefix.map(toSpec)]);

// Spec paths are two-space-indented keys under `paths:`.
const specPaths = new Set(
  [...openapi.matchAll(/^ {2}(\/\S+):/gm)].map((m) => m[1]),
);

let bad = false;
for (const p of serverPaths) if (!specPaths.has(p)) { console.error(`server route missing from openapi.yaml: ${p}`); bad = true; }
for (const p of specPaths) if (!serverPaths.has(p)) { console.error(`openapi.yaml documents a route the server does not serve: ${p}`); bad = true; }
if (bad) process.exit(1);
console.log(`openapi contract OK — ${serverPaths.size} routes documented`);
