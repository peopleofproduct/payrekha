#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseRows } from './csv.js';
import { runReplay, type ColumnMap } from './replay.js';
import { htmlReport, terminalSummary } from './report.js';

const { values } = parseArgs({
  options: {
    payouts: { type: 'string' },
    intents: { type: 'string' },
    config: { type: 'string' },
    map: { type: 'string' },
    out: { type: 'string', default: '.' },
    'hash-key': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || values.payouts === undefined) {
  console.error(`payrekha-replay --payouts payouts.csv [--intents intents.csv] [--config payrekha.json] [--map map.json] [--out dir]

  No --intents → intent-less mode: probe, cooling, velocity, band, non-prod and holiday findings only.
  Writes <out>/report.html (self-contained) and <out>/report.json. Reads files only; makes no network calls.`);
  process.exit(values.help ? 0 : 2);
}

const read = (p: string) => parseRows(readFileSync(p, 'utf8'), p);
const cfg = values.config !== undefined ? (JSON.parse(readFileSync(values.config, 'utf8')) as { rules?: object; firewall?: object; calendarFile?: string }) : {};
const holidays = cfg.calendarFile !== undefined ? ((JSON.parse(readFileSync(cfg.calendarFile, 'utf8')) as { holidays?: [] }).holidays ?? []) : [];
const fw = (cfg.firewall ?? {}) as { calendar?: { holidays?: [] } };
const report = runReplay({
  payouts: read(values.payouts),
  ...(values.intents !== undefined ? { intents: read(values.intents) } : {}),
  ...(values.map !== undefined ? { map: JSON.parse(readFileSync(values.map, 'utf8')) as ColumnMap } : {}),
  rules: cfg.rules ?? {},
  firewall: { ...fw, calendar: { ...fw.calendar, holidays: [...(fw.calendar?.holidays ?? []), ...holidays] } },
  ...(values['hash-key'] !== undefined ? { hashKey: values['hash-key'] } : {}),
});
const out = values.out ?? '.';
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
writeFileSync(`${out}/report.html`, htmlReport(report));
console.log(terminalSummary(report, process.stdout.isTTY === true && !process.env['NO_COLOR']));
console.log(`\nwrote ${out}/report.html and ${out}/report.json`);
