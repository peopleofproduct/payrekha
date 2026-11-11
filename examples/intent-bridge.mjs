#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// Zero-code intent bridge: turn your system's existing "approved" webhook
// into a managed intent — no changes on the sender side. Point your LOS /
// settlement engine's approval webhook at this process; it mints an intent
// for every event and (optionally) writes intentId → payoutId to stdout as
// JSONL you can join on later.
//
//   PAYREKHA_URL=http://payrekha:8080 PAYREKHA_MINT_TOKEN=<mint-role key> \
//   node examples/intent-bridge.mjs
//
// Swap the HTTP listener for a Kafka/SQS consumer and keep `fieldMap` +
// `mint()` — the sink is identical. To move a tier up, keep the events and
// call POST /v1/intents with your own signer instead of /v1/intents/mint.
import { createServer } from 'node:http';

const URL_ = process.env.PAYREKHA_URL ?? 'http://127.0.0.1:8080';
const TOKEN = process.env.PAYREKHA_MINT_TOKEN ?? '';
const PORT = Number(process.env.BRIDGE_PORT ?? 8090);
if (TOKEN === '') {
  console.error('PAYREKHA_MINT_TOKEN (a mint-role API key) is required');
  process.exit(1);
}

// Map YOUR event fields → the mint body. Edit this object only.
// Each value is a dot-path into the incoming JSON (e.g. 'loan.id').
const fieldMap = {
  intentId: 'loan.id', // reuse your own id → retries collapse
  kind: { const: 'LOAN_DISBURSAL' }, // fixed, or a path like 'loan.product'
  amountPaise: 'loan.amount_paise',
  account: 'beneficiary.account',
  ifsc: 'beneficiary.ifsc',
  subjectRef: 'loan.id',
};

const dig = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const resolve = (spec, ev) => (typeof spec === 'string' ? dig(ev, spec) : spec.const);

async function mint(body) {
  const r = await fetch(`${URL_}/v1/intents/mint`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return void res.end('{"error":"POST only"}');
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let ev;
  try {
    ev = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    res.statusCode = 400;
    return void res.end('{"error":"bad json"}');
  }
  const body = {
    intentId: resolve(fieldMap.intentId, ev),
    kind: resolve(fieldMap.kind, ev),
    amountPaise: resolve(fieldMap.amountPaise, ev),
    beneficiary: { account: resolve(fieldMap.account, ev), ifsc: resolve(fieldMap.ifsc, ev) },
    subjectRef: resolve(fieldMap.subjectRef, ev),
  };
  const out = await mint(body).catch((e) => ({ status: 502, json: { error: String(e) } }));
  if (out.json.intentId !== undefined)
    console.log(JSON.stringify({ at: Date.now(), payoutRef: body.intentId, intentId: out.json.intentId }));
  res.statusCode = out.status < 300 ? 200 : out.status;
  res.end(JSON.stringify(out.json));
}).listen(PORT, () => console.error(`intent-bridge on :${PORT} → ${URL_}/v1/intents/mint`));
