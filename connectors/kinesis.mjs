#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// Kinesis connector: shard-iterate → fieldmap → mint → checkpoint.
// Zero AWS-SDK dependency — JSON-RPC over the same SigV4 shape as sqs.mjs.
// Single-shard/development-grade: for multi-shard fan-out run one process
// per shard or move to KCL — mint is idempotent so overlap is safe.
//
//   AWS_REGION=ap-south-1 KINESIS_STREAM=payrekha-intents [KINESIS_SHARD=shardId-000000000000] \
//   AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… [AWS_SESSION_TOKEN=…] \
//   PAYREKHA_URL=… PAYREKHA_MINT_TOKEN=… FIELD_MAP_FILE=… node kinesis.mjs
import { createHash, createHmac } from 'node:crypto';
import { makeBridge, loadFieldMap } from './lib/bridge.mjs';

const REGION = process.env.AWS_REGION ?? 'ap-south-1';
const STREAM = process.env.KINESIS_STREAM;
if (!STREAM) {
  console.error('KINESIS_STREAM is required');
  process.exit(1);
}
const CREDS = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  sessionToken: process.env.AWS_SESSION_TOKEN,
};
const HOST = `kinesis.${REGION}.amazonaws.com`;

const sha256Hex = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d, e) => createHmac('sha256', k).update(d).digest(e);

async function kin(target, body) {
  const payload = JSON.stringify(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const scope = `${amzDate.slice(0, 8)}/${REGION}/kinesis/aws4_request`;
  const headers = `content-type:application/x-amz-json-1.1\nhost:${HOST}\nx-amz-date:${amzDate}\n`;
  const signed = 'content-type;host;x-amz-date';
  const canonical = `POST\n/\n\n${headers}\n${signed}\n${sha256Hex(payload)}`;
  let k = hmac(`AWS4${CREDS.secretAccessKey}`, amzDate.slice(0, 8));
  k = hmac(k, REGION);
  k = hmac(k, 'kinesis');
  k = hmac(k, 'aws4_request');
  const sig = hmac(k, `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`, 'hex');
  const r = await fetch(`https://${HOST}/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-date': amzDate,
      'x-amz-target': `Kinesis_20131202.${target}`,
      authorization: `AWS4-HMAC-SHA256 Credential=${CREDS.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${sig}`,
      ...(CREDS.sessionToken ? { 'x-amz-security-token': CREDS.sessionToken } : {}),
    },
    body: payload,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`kinesis ${target}: ${r.status} ${j.message ?? j.__type ?? ''}`);
  return j;
}

const handleEvent = makeBridge({
  url: process.env.PAYREKHA_URL,
  token: process.env.PAYREKHA_MINT_TOKEN,
  fieldMap: await loadFieldMap(),
});

const shard = process.env.KINESIS_SHARD ?? (await kin('ListShards', { StreamName: STREAM })).Shards[0].ShardId;
let it = (await kin('GetShardIterator', { StreamName: STREAM, ShardId: shard, ShardIteratorType: 'TRIM_HORIZON' })).ShardIterator;
console.error(`payrekha kinesis receiver on ${STREAM}/${shard}`);

for (;;) {
  const res = await kin('GetRecords', { ShardIterator: it, Limit: 100 }).catch(async (e) => {
    console.error(`getrecords: ${e} — backing off 5s`);
    await new Promise((r) => setTimeout(r, 5_000));
    return null;
  });
  if (res === null) continue;
  it = res.NextShardIterator ?? it;
  for (const rec of res.Records ?? []) {
    let ev;
    try {
      ev = JSON.parse(Buffer.from(rec.Data, 'base64').toString('utf8'));
    } catch {
      continue; // non-JSON can't fieldmap — skip
    }
    await handleEvent(ev); // ok/fail both advance: mint idempotency covers replays
  }
  if ((res.Records ?? []).length === 0) await new Promise((r) => setTimeout(r, 1_000));
}
