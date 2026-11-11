#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// Kafka connector: consume approval events, mint intents. Offsets commit
// only after the gateway accepts — a crash re-delivers, and mint is
// idempotent on intentId so replays are safe.
//
//   KAFKA_BROKERS=kafka:9092 KAFKA_TOPIC=los.disbursals KAFKA_GROUP=payrekha-intents \
//   PAYREKHA_URL=… PAYREKHA_MINT_TOKEN=… FIELD_MAP_FILE=fieldmaps/los-disbursal.json \
//   node kafka.mjs
//
// kafkajs is an optional peer — install it next to this script
// (npm i kafkajs) or use connectors/Dockerfile which ships it.
import { makeBridge, loadFieldMap } from './lib/bridge.mjs';

let Kafka;
try {
  ({ Kafka } = await import('kafkajs'));
} catch {
  console.error('kafkajs not installed — `npm i kafkajs` beside this connector, or use connectors/Dockerfile');
  process.exit(1);
}

const handleEvent = makeBridge({
  url: process.env.PAYREKHA_URL ?? 'http://127.0.0.1:8080',
  token: process.env.PAYREKHA_MINT_TOKEN ?? '',
  fieldMap: await loadFieldMap(),
});

const kafka = new Kafka({
  brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  ...(process.env.KAFKA_CLIENT_ID !== undefined ? { clientId: process.env.KAFKA_CLIENT_ID } : { clientId: 'payrekha-connector' }),
  ...(process.env.KAFKA_SASL_USER !== undefined
    ? {
        sasl: {
          mechanism: process.env.KAFKA_SASL_MECH ?? 'scram-sha-512',
          username: process.env.KAFKA_SASL_USER,
          password: process.env.KAFKA_SASL_PASS ?? '',
        },
      }
    : {}),
  ...(process.env.KAFKA_SSL === '1' ? { ssl: true } : {}),
});
const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP ?? 'payrekha-intents' });
const topic = process.env.KAFKA_TOPIC;
if (!topic) {
  console.error('KAFKA_TOPIC is required');
  process.exit(1);
}

await consumer.connect();
await consumer.subscribe({ topic, fromBeginning: process.env.KAFKA_FROM_BEGINNING === '1' });

let bad = 0;
await consumer.run({
  // autoCommit off — we commit the offset only when the mint lands.
  autoCommit: false,
  eachMessage: async ({ topic: t, partition, message, heartbeat }) => {
    let ev;
    try {
      ev = JSON.parse(message.value.toString('utf8'));
    } catch {
      bad += 1;
      console.error(`drop non-json message ${t}/${partition}@${message.offset} (total ${bad})`);
      return; // don't commit — but poison pills need a DLQ at the topic level
    }
    const out = await handleEvent(ev);
    if (!out.ok) {
      console.error(`mint failed ${t}/${partition}@${message.offset}: ${out.error} — offset held, redelivery will retry`);
      await heartbeat();
      return; // no commit → redelivery; mint is idempotent on intentId
    }
    await consumer.commitOffsets([{ topic: t, partition, offset: (Number(message.offset) + 1).toString() }]);
  },
});

const stop = async () => {
  await consumer.disconnect();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.error(`kafka connector on ${topic} → ${process.env.PAYREKHA_URL}/v1/intents/mint`);
