#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { bootFromEnv } from './config.js';

const { firewall, gateway, stateStore } = bootFromEnv();
const port = Number(process.env['PORT'] ?? 8080);
const host = process.env['HOST'] ?? '0.0.0.0';
gateway.server.listen(port, host, () => {
  console.error(`payrekha gateway on ${host}:${port} — mode ${firewall.currentMode.mode}, alert ${firewall.alertState}, rules ${firewall.ruleNames.length}`);
});
const timer = setInterval(() => void gateway.saveState(), Number(process.env['PAYREKHA_STATE_INTERVAL_MS'] ?? 5_000));
timer.unref();
const stop = () => {
  setTimeout(() => process.exit(0), 5_000).unref();
  void gateway
    .saveState()
    .then(() => stateStore?.close?.())
    .catch(() => undefined)
    .finally(() => gateway.server.close(() => process.exit(0)));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
