// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { formatIst } from '@payrekha/core';
import { rupees } from '@payrekha/rules';
import type { ReplayReport } from './replay.js';

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function terminalSummary(r: ReplayReport, color = false): string {
  const c = (code: number) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const [bold, dim, red, yellow, green] = [c(1), c(2), c(31), c(33), c(32)];
  const t = r.totals;
  const L = [
    bold(`PayRekha replay${r.intentLess ? ' (intent-less: probe, cooling, velocity, band, non-prod, holiday, settlement)' : ''}`),
    `${t.payouts} payouts, ${rupees(t.amountPaise)}  ${dim(`p99 ${Math.round(r.p99Micros)} µs`)}`,
    `  ${green('ALLOW ')} ${String(t.allow.count).padStart(6)}  ${rupees(t.allow.amountPaise)}`,
    `  ${yellow('REVIEW')} ${String(t.review.count).padStart(6)}  ${rupees(t.review.amountPaise)}  would hold`,
    `  ${red('BLOCK ')} ${String(t.block.count).padStart(6)}  ${rupees(t.block.amountPaise)}  would stop`,
  ];
  if (r.intentLess)
    L.push(
      '',
      yellow(
        'Tune before you judge — these are illustrative defaults on your data, not tuned thresholds. Suggested starting points are below; expect some noise until they are.',
      ),
    );
  if (r.pennyDrop !== undefined) {
    const pd = r.pennyDrop;
    if (pd.verificationRows > 0)
      L.push(
        dim(
          `  penny drops: ${pd.verificationRows} VERIFICATION rows → ${pd.verifiedBeneficiaries} beneficiaries verified; ${pd.boundPayouts} payouts exempted as verified`,
        ),
      );
    if (pd.tip !== undefined) L.push(yellow(`  tip: ${pd.tip}`));
  }
  if (t.degraded > 0) L.push(yellow(`  ${t.degraded} degraded (malformed rows) — reviewed, never allowed`));
  if (r.skippedRows.length > 0)
    L.push(dim(`  ${r.skippedRows.length} rows skipped (first: row ${r.skippedRows[0]!.row}, ${r.skippedRows[0]!.reason})`));
  for (const e of r.alertEpisodes)
    L.push(red(`  HIGH_ALERT ${formatIst(e.startMs)} → ${e.endMs === null ? 'end of data' : formatIst(e.endMs)}  (${e.trigger})`));
  L.push('', bold('Top rules'));
  for (const x of r.topRules.slice(0, 8)) L.push(`  ${x.rule.padEnd(30)} ${String(x.hits).padStart(6)}  ${rupees(x.amountPaise)}`);
  L.push('', bold(`Flagged chains (${r.chains.length})`));
  for (const ch of r.chains.slice(0, 5)) {
    const [a, z] = [formatIst(ch.startMs), formatIst(ch.endMs)];
    L.push(
      `  ${(ch.worst === 'BLOCK' ? red : yellow)(ch.worst)}  ${a} → ${a.slice(0, 10) === z.slice(0, 10) ? z.slice(11) : z}  ${ch.steps.length} payouts  ${rupees(ch.amountPaise)}  ${dim(ch.rules.join(', '))}`,
    );
  }
  if (r.suggested !== undefined) {
    const s = r.suggested;
    L.push('', bold('Suggested starting thresholds (from this export — illustrative)'));
    const p = s.percentiles;
    L.push(
      dim(
        `  per-source 10-min windows: p95 ${p.windowCountP95} / p99 ${p.windowCountP99} payouts · p95 ${rupees(p.windowSumP95Paise)} / p99 ${rupees(p.windowSumP99Paise)}`,
      ),
    );
    L.push(
      dim(
        `  amounts: p75 ${rupees(p.amountP75Paise)}${p.nonMicroP25Paise !== undefined ? ` · p25 non-micro ${rupees(p.nonMicroP25Paise)}` : ''}${p.microP95Paise !== undefined ? ` · p95 micro ${p.microP95Paise} paise` : ''}`,
      ),
    );
    L.push('  paste into payrekha.json and tighten from there:');
    L.push(dim(`  ${JSON.stringify(s.config)}`));
  }
  L.push(
    '',
    dim(`False-positive review list: ${r.falsePositiveReview.length} single-rule REVIEWs — check these before you turn on enforce.`),
  );
  return L.join('\n');
}

export function htmlReport(r: ReplayReport): string {
  const t = r.totals;
  const row = (cells: unknown[]) => `<tr>${cells.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`;
  const verdictCls = (v: string) => (v === 'BLOCK' ? 'b' : v === 'REVIEW' ? 'r' : 'a');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PayRekha replay report</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;margin:2rem auto;max-width:1100px;padding:0 1rem;color:#1b1b1f;background:#fafaf7}
h1{font-size:1.5rem;margin:0}h2{font-size:1.1rem;margin-top:2rem;border-bottom:1px solid #ddd;padding-bottom:.25rem}
.sub{color:#666}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;margin-top:1rem}
.card{background:#fff;border:1px solid #e3e3df;border-radius:8px;padding:.75rem 1rem}.card .n{font-size:1.5rem;font-weight:600}
.a{color:#137333}.r{color:#b06000}.b{color:#c5221f}table{border-collapse:collapse;width:100%;background:#fff}
td,th{border-bottom:1px solid #eee;padding:.35rem .5rem;text-align:left;vertical-align:top}th{font-weight:600;background:#f3f3ef}
code{font:12px ui-monospace,monospace}.chain{background:#fff;border:1px solid #e3e3df;border-radius:8px;padding:.5rem 1rem;margin:.75rem 0}
.banner{background:#fff7e6;border:1px solid #f0c36d;border-radius:8px;padding:.75rem 1rem;margin-top:1rem}
.tip{background:#fff7e6;border:1px solid #f0c36d;border-radius:8px;padding:.5rem 1rem;margin:.75rem 0}
pre{background:#f3f3ef;border-radius:8px;padding:.75rem 1rem;overflow-x:auto}
</style></head><body>
<h1>PayRekha replay report</h1>
<div class="sub">${esc(r.generatedAt)} · ${r.intentLess ? 'intent-less mode (intent rules skipped)' : 'with intents'} · ${t.payouts} payouts · p99 ${Math.round(r.p99Micros)} µs</div>
${r.intentLess ? `<div class="banner"><b>Tune before you judge.</b> The verdicts above use illustrative defaults on your data, not tuned thresholds — expect some noise until they are. Suggested starting points are at the bottom; paste them into <code>payrekha.json</code> and tighten from there.</div>` : ''}
<div class="cards">
<div class="card"><div>Total</div><div class="n">${esc(rupees(t.amountPaise))}</div><div>${t.payouts} payouts</div></div>
<div class="card"><div class="a">Allowed</div><div class="n">${esc(rupees(t.allow.amountPaise))}</div><div>${t.allow.count}</div></div>
<div class="card"><div class="r">Would REVIEW</div><div class="n">${esc(rupees(t.review.amountPaise))}</div><div>${t.review.count}</div></div>
<div class="card"><div class="b">Would BLOCK</div><div class="n">${esc(rupees(t.block.amountPaise))}</div><div>${t.block.count}</div></div>
</div>
${r.alertEpisodes.length > 0 ? `<h2>HIGH_ALERT episodes</h2><table><tr><th>Entered</th><th>Reset (simulated)</th><th>Trigger</th></tr>${r.alertEpisodes.map((e) => row([formatIst(e.startMs), e.endMs === null ? 'end of data' : formatIst(e.endMs), e.trigger])).join('')}</table>` : ''}
<h2>Top rules</h2><table><tr><th>Rule</th><th>Hits</th><th>Amount</th></tr>${r.topRules.map((x) => row([x.rule, x.hits, rupees(x.amountPaise)])).join('')}</table>
<h2>Flagged chains</h2>${r.chains
    .slice(0, 50)
    .map(
      (
        ch,
      ) => `<div class="chain"><b class="${verdictCls(ch.worst)}">${ch.worst}</b> · ${esc(formatIst(ch.startMs))} → ${esc(formatIst(ch.endMs))} · ${ch.steps.length} payouts · ${esc(rupees(ch.amountPaise))} · <code>${esc(ch.rules.join(', '))}</code>
<table><tr><th>Time (IST)</th><th>Payout</th><th>Kind</th><th>Amount</th><th>Verdict</th><th>Why</th></tr>${ch.steps
        .map(
          (s) =>
            `<tr><td>${esc(formatIst(s.atMs))}</td><td><code>${esc(s.payoutId)}</code></td><td>${esc(s.kind)}</td><td>${esc(rupees(s.amountPaise))}</td><td class="${verdictCls(s.verdict)}">${s.verdict}</td><td>${s.hits.map((h) => `<code>${esc(h.rule)}</code> ${esc(h.reason)}`).join('<br>')}</td></tr>`,
        )
        .join('')}</table></div>`,
    )
    .join('')}
${r.pennyDrop !== undefined && (r.pennyDrop.verificationRows > 0 || r.pennyDrop.tip !== undefined) ? `<h2>Penny drops</h2>${r.pennyDrop.verificationRows > 0 ? `<p>${r.pennyDrop.verificationRows} rows tagged <code>kind=VERIFICATION</code> verified ${r.pennyDrop.verifiedBeneficiaries} beneficiaries — ${r.pennyDrop.boundPayouts} later payouts to them were exempted from <code>probe.micro-then-large</code> and <code>beneficiary.cooling</code>, exactly as they would be under signed intents.</p>` : ''}${r.pennyDrop.tip !== undefined ? `<div class="tip"><b>Tip:</b> ${esc(r.pennyDrop.tip)}</div>` : ''}` : ''}
<h2>False-positive review list</h2><p class="sub">Single-rule REVIEWs, largest first. Confirm these are fine (or tune the rule) before switching to enforce.</p>
<table><tr><th>Time (IST)</th><th>Payout</th><th>Kind</th><th>Amount</th><th>Rule</th><th>Reason</th></tr>${r.falsePositiveReview.map((f) => row([formatIst(f.atMs), f.payoutId, f.kind, rupees(f.amountPaise), f.hits[0]?.rule ?? '', f.hits[0]?.reason ?? ''])).join('')}</table>
${
  r.suggested !== undefined
    ? `<h2>Suggested starting thresholds</h2><p class="sub">Derived from this export's own distribution — illustrative, not a verdict. Paste into <code>payrekha.json</code> and tighten from there.</p>
<table><tr><th>Signal</th><th>Observed</th><th>Suggests</th></tr>
${row(['per-source payouts / 10 min (p95 → p99)', `${r.suggested.percentiles.windowCountP95} → ${r.suggested.percentiles.windowCountP99}`, 'velocity.perSourceKey.count'])}
${row(['per-source amount / 10 min (p95 → p99)', `${rupees(r.suggested.percentiles.windowSumP95Paise)} → ${rupees(r.suggested.percentiles.windowSumP99Paise)}`, 'velocity.perSourceKey.sumPaise'])}
${row(['p75 payout amount', rupees(r.suggested.percentiles.amountP75Paise), 'cooling.minAmountPaise'])}
${r.suggested.percentiles.nonMicroP25Paise !== undefined ? row(['p25 non-micro amount', rupees(r.suggested.percentiles.nonMicroP25Paise), 'probe.largePaise']) : ''}
${r.suggested.percentiles.microP95Paise !== undefined ? row(['p95 micro amount', `${r.suggested.percentiles.microP95Paise} paise`, 'firewall.microPaise']) : ''}
</table>
<pre>${esc(JSON.stringify(r.suggested.config, null, 2))}</pre>`
    : ''
}
<p class="sub">Beneficiaries appear only as keyed hashes. Generated by PayRekha replay — Apache-2.0.</p>
</body></html>
`;
}
