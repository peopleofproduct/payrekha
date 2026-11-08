#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// RabbitMQ connector: consume → fieldmap → mint intent → ack. Ack only
// after the gateway accepts; a failure nacks to the dead-letter queue (no
// poison loop). Mint is idempotent on intentId, so redelivery is safe.
// Requires `amqplib` where you deploy — it's the connector's only dep.
//
//   AMQP_URL=amqp://… AMQP_QUEUE=payrekha-intents FIELD_MAP_FILE=./los-disbursal.json \
//   PAYREKHA_URL=… PAYREKHA_MINT_TOKEN=… node rabbitmq.mjs
import { makeBridge, loadFieldMap } from './lib/bridge.mjs';

const { AMQP_URL, AMQP_QUEUE = 'payrekha-intents' } = process.env;
if (!AMQP_URL) {
  console.error('AMQP_URL is required');
  process.exit(1);
}
const handleEvent = makeBridge({
  url: process.env.PAYREKHA_URL,
  token: process.env.PAYREKHA_MINT_TOKEN,
  fieldMap: await loadFieldMap(),
});

const amqp = await import('amqplib');
const conn = await amqp.connect(AMQP_URL);
const ch = await conn.createChannel();
await ch.assertQueue(AMQP_QUEUE, { durable: true });
ch.prefetch(8);
console.error(`payrekha rabbitmq receiver on ${AMQP_QUEUE}`);
void ch.consume(AMQP_QUEUE, (msg) => {
  if (msg === null) return;
  let ev;
  try {
    ev = JSON.parse(msg.content.toString('utf8'));
  } catch {
    ch.nack(msg, false, false); // non-JSON → dead-letter
    return;
  }
  handleEvent(ev)
    .then((out) => (out.ok ? ch.ack(msg) : ch.nack(msg, false, false)))
    .catch(() => ch.nack(msg, false, true)); // bridge crashed → requeue once
});
