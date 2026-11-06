#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseRows } from './csv.js';
import { runReplay, type ColumnMap } from './replay.js';
import { htmlReport, terminalSummary } from './report.js';

const die = (msg: string): never => {
  console.error(`payrekha-replay: ${msg}`);
  process.exit(1);
};

const { values } = (() => {
  try {
    return parseArgs({
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
  } catch (e) {
    return die(`${(e as Error).message} — run with --help to see usage`);
  }
})();

if (values.help || values.payouts === undefined) {
  console.error(`payrekha-replay --payouts payouts.csv [--intents intents.csv] [--config payrekha.json] [--map map.json] [--out dir]

  No --intents → intent-less mode: probe, cooling, velocity, band, non-prod and holiday findings only.
  Writes <out>/report.html (self-contained) and <out>/report.json. Reads files only; makes no network calls.`);
  process.exit(values.help ? 0 : 2);
}

const readFile = (p: string): string => {
  try {
    return readFileSync(p, 'utf8');
  } catch (e) {
    return die(`cannot read ${p}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
};
const readCsv = (p: string) => {
  try {
    return parseRows(readFile(p), p);
  } catch (e) {
    return die(`cannot parse CSV ${p}: ${(e as Error).message}`);
  }
};
const readJson = (p: string): unknown => {
  try {
    return JSON.parse(readFile(p)) as unknown;
  } catch (e) {
    return die(`invalid JSON in ${p}: ${(e as Error).message}`);
  }
};

const cfg = values.config !== undefined ? (readJson(values.config) as { rules?: object; firewall?: object; calendarFile?: string }) : {};
const holidays = cfg.calendarFile !== undefined ? ((readJson(cfg.calendarFile) as { holidays?: [] }).holidays ?? []) : [];
const fw = (cfg.firewall ?? {}) as { calendar?: { holidays?: [] } };
const report = runReplay({
  payouts: readCsv(values.payouts),
  ...(values.intents !== undefined ? { intents: readCsv(values.intents) } : {}),
  ...(values.map !== undefined ? { map: readJson(values.map) as ColumnMap } : {}),
  rules: cfg.rules ?? {},
  firewall: { ...fw, calendar: { ...fw.calendar, holidays: [...(fw.calendar?.holidays ?? []), ...holidays] } },
  ...(values['hash-key'] !== undefined ? { hashKey: values['hash-key'] } : {}),
});
const out = values.out ?? '.';
try {
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${out}/report.html`, htmlReport(report));
} catch (e) {
  die(`cannot write reports to ${out}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
}
console.log(terminalSummary(report, process.stdout.isTTY === true && !process.env['NO_COLOR']));
console.log(`\nwrote ${out}/report.html and ${out}/report.json`);
