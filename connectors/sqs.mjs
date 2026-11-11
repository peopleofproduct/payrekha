#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// SQS connector: long-poll a queue, mint intents, delete only after the
// gateway accepts. Zero AWS-SDK dependency — the JSON-RPC calls go through
// a small SigV4 signer over node:crypto (same construction as
// @payrekha/client/kms).
//
//   AWS_REGION=ap-south-1 SQS_QUEUE_URL=https://sqs.ap-south-1.amazonaws.com/123/q \
//   AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… [AWS_SESSION_TOKEN=…] \
//   PAYREKHA_URL=… PAYREKHA_MINT_TOKEN=… FIELD_MAP_FILE=… node sqs.mjs
import { createHash, createHmac } from 'node:crypto';
import { makeBridge, loadFieldMap } from './lib/bridge.mjs';

const REGION = process.env.AWS_REGION ?? 'ap-south-1';
const QUEUE = process.env.SQS_QUEUE_URL;
if (!QUEUE) {
  console.error('SQS_QUEUE_URL is required');
  process.exit(1);
}
const CREDS = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  sessionToken: process.env.AWS_SESSION_TOKEN,
};
if (!CREDS.accessKeyId || !CREDS.secretAccessKey) {
  console.error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are required (or use IRSA + a sidecar)');
  process.exit(1);
}
const HOST = new URL(QUEUE).host;

const sha256Hex = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d, e) => createHmac('sha256', k).update(d).digest(e);

async function sqs(target, body) {
  const payload = JSON.stringify(body);
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const headers = {
    'content-type': 'application/x-amz-json-1.0',
    host: HOST,
    'x-amz-date': amzDate,
    'x-amz-target': `AmazonSQS.${target}`,
    ...(CREDS.sessionToken !== undefined ? { 'x-amz-security-token': CREDS.sessionToken } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalRequest = ['POST', '/', '', names.map((k) => `${k}:${headers[k]}\n`).join(''), names.join(';'), sha256Hex(payload)].join(
    '\n',
  );
  const scope = `${dateStamp}/${REGION}/sqs/aws4_request`;
  let key = hmac(`AWS4${CREDS.secretAccessKey}`, dateStamp);
  key = hmac(key, REGION);
  key = hmac(key, 'sqs');
  key = hmac(key, 'aws4_request');
  const signature = hmac(key, `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`, 'hex');
  const res = await fetch(`https://${HOST}/`, {
    method: 'POST',
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${CREDS.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
    },
    body: payload,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`sqs ${target} ${res.status}: ${json.message ?? res.statusText}`);
  return json;
}

const handleEvent = makeBridge({
  url: process.env.PAYREKHA_URL ?? 'http://127.0.0.1:8080',
  token: process.env.PAYREKHA_MINT_TOKEN ?? '',
  fieldMap: await loadFieldMap(),
});

console.error(`sqs connector on ${QUEUE} → ${process.env.PAYREKHA_URL}/v1/intents/mint`);
let running = true;
process.on('SIGINT', () => (running = false));
process.on('SIGTERM', () => (running = false));

while (running) {
  const batch = await sqs('ReceiveMessage', {
    QueueUrl: QUEUE,
    MaxNumberOfMessages: Number(process.env.SQS_BATCH ?? 5),
    WaitTimeSeconds: 20,
    VisibilityTimeout: Number(process.env.SQS_VISIBILITY ?? 60),
  }).catch((e) => {
    console.error(`receive error: ${e} — backing off 5s`);
    return null;
  });
  if (batch === null) {
    await new Promise((r) => setTimeout(r, 5_000));
    continue;
  }
  for (const msg of batch.Messages ?? []) {
    let ev;
    try {
      ev = JSON.parse(msg.Body);
    } catch {
      // Non-JSON: delete it — a poison message blocks the queue otherwise.
      await sqs('DeleteMessage', { QueueUrl: QUEUE, ReceiptHandle: msg.ReceiptHandle });
      continue;
    }
    const out = await handleEvent(ev);
    if (out.ok) {
      await sqs('DeleteMessage', { QueueUrl: QUEUE, ReceiptHandle: msg.ReceiptHandle });
    }
    // not ok → visibility timeout expires → redelivery; mint is idempotent
  }
}
