#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { bootFromEnv } from './config.js';

const { firewall, gateway } = bootFromEnv();
const port = Number(process.env['PORT'] ?? 8080);
const host = process.env['HOST'] ?? '0.0.0.0';
gateway.server.listen(port, host, () => {
  console.error(`payrekha gateway on ${host}:${port} — mode ${firewall.currentMode.mode}, alert ${firewall.alertState}, rules ${firewall.ruleNames.length}`);
});
const timer = setInterval(() => gateway.saveState(), Number(process.env['PAYREKHA_STATE_INTERVAL_MS'] ?? 5_000));
timer.unref();
const stop = () => {
  gateway.saveState();
  gateway.server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
