// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { htmlReport, parseCsv, parseTime, runReplay, terminalSummary } from '@payrekha/replay';

const HK = 'replay-test-hash-key-0123456789';

describe('replay', () => {
  it('parses CSV with quotes and CRLF', () => {
    assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n'), [{ a: 'x, y', b: 'he said "hi"' }]);
  });
  it('treats bare timestamps as IST', () => {
    assert.equal(parseTime('2026-10-12 02:10:00'), Date.UTC(2026, 9, 11, 20, 40));
  });
  const payouts = [
    { payout_id: 'v', timestamp: '2026-10-01 10:00:00', kind: 'VERIFICATION', amount_paise: '100', beneficiary_vpa: 'bb@oksbi', intent_id: 'ver-1' },
    { payout_id: 'd', timestamp: '2026-10-01 10:30:00', kind: 'LOAN_DISBURSAL', amount_paise: '20000000', beneficiary_vpa: 'bb@oksbi', intent_id: 'disb-1' },
    { payout_id: 'p1', timestamp: '2026-10-12 02:10:00', kind: 'LOAN_DISBURSAL', amount_paise: '100', beneficiary_vpa: 'mm@okaxis' },
    { payout_id: 'p2', timestamp: '2026-10-12 02:13:00', kind: 'LOAN_DISBURSAL', amount_rupees: '4,99,999.00', beneficiary_vpa: 'mm@okaxis' },
    { payout_id: 'u', timestamp: '2026-10-12 02:20:00', kind: 'VENDOR_PAYOUT', amount_paise: '100000', beneficiary_vpa: 'uu@okaxis', origin: 'nonprod' },
    { payout_id: 'bad', timestamp: 'yesterday', kind: 'REFUND', amount_paise: '1' },
  ];
  const intents = [
    { intent_id: 'ver-1', kind: 'VERIFICATION', max_amount_paise: '100', beneficiary_vpa: 'bb@oksbi', subject_ref: 'loan-1', not_before: '2026-10-01 09:00:00', expires_at: '2026-10-02 09:00:00' },
    { intent_id: 'disb-1', kind: 'LOAN_DISBURSAL', max_amount_paise: '20000000', beneficiary_vpa: 'bb@oksbi', subject_ref: 'loan-1', not_before: '2026-10-01 09:00:00', expires_at: '2026-10-02 09:00:00' },
  ];
  it('with intents: legit chain allowed, attacks blocked, bad rows skipped', () => {
    const r = runReplay({ payouts, intents, hashKey: HK });
    assert.equal(r.totals.payouts, 5);
    assert.equal(r.skippedRows.length, 1);
    assert.equal(r.totals.allow.count, 2);
    assert.equal(r.totals.block.count, 3);
    assert.ok(r.topRules.some((x) => x.rule === 'intent.missing'));
    assert.ok(r.chains.length >= 1);
  });
  it('intent-less: probe and non-prod still found, intent rules skipped', () => {
    const r = runReplay({ payouts, hashKey: HK });
    assert.equal(r.intentLess, true);
    const rules = r.topRules.map((x) => x.rule);
    assert.ok(rules.includes('probe.micro-then-large'));
    assert.ok(rules.includes('origin.nonprod'));
    assert.ok(!rules.some((x) => x.startsWith('intent.')));
  });
  it('intent-less: VERIFICATION rows verify the beneficiary — no probe or cooling hit on the payout that follows', () => {
    const rows = [
      { payout_id: 'v1', timestamp: '2026-10-12 02:10:00', kind: 'VERIFICATION', amount_paise: '100', beneficiary_vpa: 'nn@okhdfc' },
      { payout_id: 'd1', timestamp: '2026-10-12 02:20:00', kind: 'LOAN_DISBURSAL', amount_paise: '50000000', beneficiary_vpa: 'nn@okhdfc' },
    ];
    const r = runReplay({ payouts: rows, hashKey: HK });
    const d1 = r.flagged.find((f) => f.payoutId === 'd1');
    const rules = d1?.hits.map((h) => h.rule) ?? [];
    assert.ok(!rules.includes('probe.micro-then-large'), `probe should not fire on a verified beneficiary: ${rules}`);
    assert.ok(!rules.includes('beneficiary.cooling'), `cooling should not fire on a verified beneficiary: ${rules}`);
    assert.equal(r.pennyDrop?.verificationRows, 1);
    assert.equal(r.pennyDrop?.verifiedBeneficiaries, 1);
    assert.equal(r.pennyDrop?.boundPayouts, 1);
  });
  it('intent-less: VERIFICATION binds on subject_ref, dedupes per beneficiary, and falls back unbound on a bad kind', () => {
    const rows = [
      { payout_id: 'v1', timestamp: '2026-10-12 02:10:00', kind: 'VERIFICATION', amount_paise: '100', beneficiary_vpa: 'ss@okhdfc', subject_ref: 'loan-77' },
      { payout_id: 'v2', timestamp: '2026-10-12 02:11:00', kind: 'VERIFICATION', amount_paise: '100', beneficiary_vpa: 'ss@okhdfc' },
      { payout_id: 'd1', timestamp: '2026-10-12 02:20:00', kind: 'LOAN_DISBURSAL', amount_paise: '50000000', beneficiary_vpa: 'ss@okhdfc' },
      { payout_id: 'w1', timestamp: '2026-10-12 02:25:00', kind: 'NOT_A_KIND', amount_paise: '6000000', beneficiary_vpa: 'ss@okhdfc' },
      { payout_id: 'mc', timestamp: '2026-10-12 02:30:00', event: 'account_changed', merchant_id: 'm-9', beneficiary_vpa: 'ss@okhdfc' },
    ];
    const r = runReplay({ payouts: rows, hashKey: HK });
    assert.equal(r.pennyDrop?.verificationRows, 2);
    assert.equal(r.pennyDrop?.verifiedBeneficiaries, 1);
    // A bad kind can't synthesize a binding intent — w1 evaluated unbound
    // and malformed rows still degrade to REVIEW rather than slipping through.
    const w1 = r.flagged.find((f) => f.payoutId === 'w1');
    assert.ok(w1 !== undefined && w1.degraded === true, `expected degraded REVIEW on bad kind: ${JSON.stringify(w1)}`);
  });
  it('intent-less: a high-alert episode resets after the simulated window', () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ payout_id: `b${i}`, timestamp: `2026-10-12 02:${String(i).padStart(2, '0')}:00`, kind: 'REFUND', amount_paise: '3000000000', beneficiary_vpa: `bb${i}@okaxis`, source_key_id: 'k-burst' }));
    rows.push({ payout_id: 'after', timestamp: '2026-10-13 10:00:00', kind: 'REFUND', amount_paise: '4000', beneficiary_vpa: 'zz@okaxis', source_key_id: 'k-burst' });
    const r = runReplay({ payouts: rows, hashKey: HK });
    assert.ok(r.alertEpisodes.length >= 1);
    assert.ok(r.alertEpisodes[0]!.endMs !== null, 'episode should close after the simulated reset window');
  });
  it('intent-less: empty export yields zero percentiles without crashing', () => {
    const r = runReplay({ payouts: [], hashKey: HK });
    assert.equal(r.totals.payouts, 0);
    assert.deepEqual(r.suggested?.config.rules, {});
  });
  it('intent-less: untagged micro→large still reads as a probe, and the report tips tagging', () => {
    const r = runReplay({
      payouts: [
        { payout_id: 'm1', timestamp: '2026-10-12 02:10:00', kind: 'LOAN_DISBURSAL', amount_paise: '100', beneficiary_vpa: 'qq@okicici' },
        { payout_id: 'm2', timestamp: '2026-10-12 02:13:00', kind: 'LOAN_DISBURSAL', amount_paise: '50000000', beneficiary_vpa: 'qq@okicici' },
      ],
      hashKey: HK,
    });
    assert.ok(r.topRules.some((x) => x.rule === 'probe.micro-then-large'));
    assert.ok(r.pennyDrop?.tip !== undefined && r.pennyDrop.tip.includes('VERIFICATION'));
  });
  it('chains are time-sorted and never end before they start', () => {
    const r = runReplay({
      payouts: [
        { payout_id: 'n1', timestamp: '2026-10-12 23:50:00', kind: 'LOAN_DISBURSAL', amount_paise: '100', beneficiary_vpa: 'rr@okaxis' },
        { payout_id: 'n2', timestamp: '2026-10-12 23:55:00', kind: 'LOAN_DISBURSAL', amount_paise: '50000000', beneficiary_vpa: 'rr@okaxis' },
        { payout_id: 'n3', timestamp: '2026-10-13 00:10:00', kind: 'LOAN_DISBURSAL', amount_paise: '60000000', beneficiary_vpa: 'rr@okaxis' },
      ],
      hashKey: HK,
    });
    assert.ok(r.chains.length >= 1);
    for (const ch of r.chains) {
      assert.ok(ch.startMs <= ch.endMs, `chain inverted: ${ch.startMs} → ${ch.endMs}`);
      const times = ch.steps.map((s) => s.atMs);
      assert.deepEqual(times, [...times].sort((a, b) => a - b));
    }
    const term = terminalSummary(r);
    assert.ok(term.includes('→'));
    assert.ok(term.includes('Tune before you judge'));
    assert.ok(term.includes('Suggested starting thresholds'));
  });
  it('terminal summary renders same-day chain ranges compactly', () => {
    const r = runReplay({
      payouts: [
        { payout_id: 's1', timestamp: '2026-10-12 14:00:00', kind: 'LOAN_DISBURSAL', amount_paise: '100', beneficiary_vpa: 'tt@okaxis' },
        { payout_id: 's2', timestamp: '2026-10-12 14:05:00', kind: 'LOAN_DISBURSAL', amount_paise: '50000000', beneficiary_vpa: 'tt@okaxis' },
        { payout_id: 's3', timestamp: '2026-10-12 14:20:00', kind: 'LOAN_DISBURSAL', amount_paise: '60000000', beneficiary_vpa: 'tt@okaxis' },
      ],
      hashKey: HK,
    });
    const term = terminalSummary(r);
    // Cross-day chains print the full end date; same-day chains print time only.
    assert.ok(/14:00:00 IST → 14:\d\d:00 IST/.test(term) || /14:00:00 IST → 2026/.test(term) === false);
  });
  it('cli: --out creates a missing directory; bad paths fail cleanly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'payrekha-replay-'));
    const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
    try {
      const csv = join(dir, 'p.csv');
      writeFileSync(csv, 'payout_id,timestamp,kind,amount_paise,beneficiary_vpa\np1,2026-10-12 02:10:00,REFUND,100,aa@okaxis\n');
      const out = join(dir, 'new', 'nested');
      const ok = spawnSync(process.execPath, [cli, '--payouts', csv, '--out', out], { encoding: 'utf8' });
      assert.equal(ok.status, 0, ok.stderr);
      assert.ok(ok.stdout.includes('report.html'));
      const bad = spawnSync(process.execPath, [cli, '--payouts', join(dir, 'missing.csv')], { encoding: 'utf8' });
      assert.equal(bad.status, 1);
      assert.ok(bad.stderr.includes('cannot read') && !bad.stderr.includes('    at '), `expected friendly error, got: ${bad.stderr}`);
      const badJson2 = join(dir, 'bad.json');
      writeFileSync(badJson2, '[{invalid');
      const badParse = spawnSync(process.execPath, [cli, '--payouts', badJson2], { encoding: 'utf8' });
      assert.equal(badParse.status, 1);
      assert.ok(badParse.stderr.includes('cannot parse') && !badParse.stderr.includes('    at '));
      const badJson = join(dir, 'bad.json');
      writeFileSync(badJson, '{nope');
      const badCfg = spawnSync(process.execPath, [cli, '--payouts', csv, '--config', badJson], { encoding: 'utf8' });
      assert.equal(badCfg.status, 1);
      assert.ok(badCfg.stderr.includes('invalid JSON'));
      const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
      assert.equal(help.status, 0);
      const noArgs = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
      assert.equal(noArgs.status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('HTML is self-contained, escaped and has no raw identifiers', () => {
    const html = htmlReport(runReplay({ payouts: [...payouts, { payout_id: '<script>x</script>', timestamp: '2026-10-12 03:00:00', kind: 'REFUND', amount_paise: '100', beneficiary_vpa: 'zz@okaxis', origin: 'nonprod' }], hashKey: HK }));
    assert.ok(!html.includes('<script>'));
    assert.ok(!/(src|href)="https?:/.test(html));
    assert.ok(!html.includes('mm@okaxis'));
  });
});
