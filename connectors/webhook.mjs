#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// Webhook receiver: your system's "approved" event POSTs here; each one
// becomes a managed intent at the gateway. Productized intent-bridge —
// same shape, fieldMap from env/file instead of source edits.
//
//   PAYREKHA_URL=http://payrekha:8080 PAYREKHA_MINT_TOKEN=<mint-role key> \
//   FIELD_MAP_FILE=fieldmaps/los-disbursal.json node webhook.mjs
//
// Optional shared-secret check: set BRIDGE_HOOK_SECRET and callers must
// send `x-bridge-token: <secret>` — the receiver sits on the same network
// policy as the gateway, but cheap auth stops cross-talk.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { makeBridge, loadFieldMap } from './lib/bridge.mjs';

const PORT = Number(process.env.BRIDGE_PORT ?? 8090);
const SECRET = process.env.BRIDGE_HOOK_SECRET ?? '';
if (SECRET === '')
  console.error(
    'warning: BRIDGE_HOOK_SECRET unset — this receiver accepts unauthenticated events; set it or restrict network access to the port',
  );
const handleEvent = makeBridge({
  url: process.env.PAYREKHA_URL ?? 'http://127.0.0.1:8080',
  token: process.env.PAYREKHA_MINT_TOKEN ?? '',
  fieldMap: await loadFieldMap(),
});
const MAX_BODY = Number(process.env.BRIDGE_MAX_BODY ?? 262_144);

const okToken = (req) => {
  if (SECRET === '') return true;
  const got = Buffer.from(String(req.headers['x-bridge-token'] ?? ''));
  const want = Buffer.from(SECRET);
  return got.length === want.length && timingSafeEqual(got, want);
};

createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method === 'GET' && req.url === '/healthz') {
    res.statusCode = 200;
    return void res.end('{"ok":true}');
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return void res.end('{"error":"POST only"}');
  }
  if (!okToken(req)) {
    res.statusCode = 401;
    return void res.end('{"error":"bad x-bridge-token"}');
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) {
      res.statusCode = 413;
      return void res.end('{"error":"body too large"}');
    }
    chunks.push(c);
  }
  let ev;
  try {
    ev = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    res.statusCode = 400;
    return void res.end('{"error":"bad json"}');
  }
  const out = await handleEvent(ev);
  res.statusCode = out.ok ? 200 : out.status === 502 ? 502 : Math.max(out.status, 400);
  res.end(JSON.stringify(out));
}).listen(PORT, () => console.error(`intent-webhook on :${PORT} → ${process.env.PAYREKHA_URL}/v1/intents/mint`));
