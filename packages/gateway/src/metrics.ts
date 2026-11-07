// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import type { Payrekha } from '@payrekha/core';
import type { GatewayStats } from './server.js';
import type { WebhookSender } from './webhook.js';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/** Prometheus text exposition. Metric names are stable API. */
export function renderMetrics(fw: Payrekha, stats: GatewayStats, webhook?: WebhookSender, logErrors = 0): string {
  const m = fw.metrics;
  const L: string[] = [];
  const metric = (name: string, type: string, help: string, rows: [string, number][]) => {
    L.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, v] of rows) L.push(`${name}${labels} ${v}`);
  };
  metric('payrekha_evaluations_total', 'counter', 'Payouts evaluated.', [['', m.evaluated]]);
  metric('payrekha_verdicts_total', 'counter', 'Calculated verdicts.', [
    ['{verdict="ALLOW"}', m.verdicts.allow],
    ['{verdict="REVIEW"}', m.verdicts.review],
    ['{verdict="BLOCK"}', m.verdicts.block],
  ]);
  metric('payrekha_effective_actions_total', 'counter', 'What the caller was told to do (shadow → always ALLOW).', Object.entries(m.effective).map(([k, v]) => [`{action="${k}"}`, v]));
  metric('payrekha_rule_hits_total', 'counter', 'Rule hits by rule id.', Object.entries(m.ruleHits).map(([k, v]) => [`{rule="${esc(k)}"}`, v]));
  metric('payrekha_rule_errors_total', 'counter', 'Rules that threw (verdicts degraded).', Object.entries(m.ruleErrors).map(([k, v]) => [`{rule="${esc(k)}"}`, v]));
  metric('payrekha_degraded_total', 'counter', 'Degraded verdicts (malformed input or rule error).', [['', m.degraded]]);
  metric('payrekha_deduped_total', 'counter', 'Retries answered from the dedupe cache.', [['', m.deduped]]);
  metric('payrekha_high_alert', 'gauge', '1 while HIGH_ALERT is active.', [['', m.highAlert ? 1 : 0]]);
  metric('payrekha_intents', 'gauge', 'Registered intents held.', [['', m.intents]]);
  metric('payrekha_beneficiaries_tracked', 'gauge', 'Hashed beneficiary refs in the bounded ledger.', [['', m.beneficiaries]]);
  metric('payrekha_canaries', 'gauge', 'Canary refs registered.', [['', m.canaries]]);
  L.push('# HELP payrekha_eval_latency_micros Evaluation latency in microseconds.', '# TYPE payrekha_eval_latency_micros histogram');
  let cum = 0;
  m.latencyMicros.buckets.forEach((b, i) => {
    cum += m.latencyMicros.counts[i] ?? 0;
    L.push(`payrekha_eval_latency_micros_bucket{le="${b}"} ${cum}`);
  });
  L.push(`payrekha_eval_latency_micros_bucket{le="+Inf"} ${m.evaluated}`, `payrekha_eval_latency_micros_sum ${m.latencyMicros.sum}`, `payrekha_eval_latency_micros_count ${m.evaluated}`);
  metric('payrekha_http_requests_total', 'counter', 'HTTP requests by method, route and status.', [...stats.requests].map(([k, v]) => {
    const [method, route, status] = k.split(' ');
    return [`{method="${method}",route="${route}",status="${status}"}`, v];
  }));
  metric('payrekha_ready', 'gauge', '1 when the gateway is ready.', [['', stats.ready ? 1 : 0]]);
  metric('payrekha_state_save_errors_total', 'counter', 'Failed state snapshots.', [['', stats.stateSaveErrors]]);
  L.push(
    '# HELP payrekha_state_save_ms Snapshot save wall time — export (sync) + serialize + write.',
    '# TYPE payrekha_state_save_ms summary',
    `payrekha_state_save_ms_sum ${stats.stateSaveMs.sum}`,
    `payrekha_state_save_ms_count ${stats.stateSaveMs.count}`,
    `payrekha_state_save_ms_max ${stats.stateSaveMs.max}`,
  );
  metric('payrekha_decision_log_errors_total', 'counter', 'Failed decision-log writes.', [['', stats.logErrors + logErrors]]);
  metric('payrekha_hook_errors_total', 'counter', 'Decision/audit hooks that threw.', [['', m.hookErrors]]);
  if (stats.shared !== undefined) {
    const s = stats.shared;
    metric('payrekha_shared_commits_total', 'counter', 'Shared-state commit transactions attempted.', [['', s.commits]]);
    metric('payrekha_shared_committed_total', 'counter', 'Shared-state commits that landed.', [['', s.committed]]);
    metric('payrekha_shared_conflicts_total', 'counter', 'Commit conflicts by kind.', Object.entries(s.conflicts).map(([k, v]) => [`{conflict="${k}"}`, v]));
    metric('payrekha_shared_failclosed_total', 'counter', 'Payouts failed closed on a shared-store outage.', [['', s.failClosed]]);
    metric('payrekha_shared_miss_fetches_total', 'counter', 'Intents fetched from the shared store after a local miss.', [['', s.missFetches]]);
    metric('payrekha_shared_stale_syncs_total', 'counter', 'Blocks re-evaluated after a shared-counter refresh.', [['', s.staleSyncs]]);
    metric('payrekha_shared_purged_reservations_total', 'counter', 'Settled reservation tombstones purged by retention.', [['', s.purgedReservations]]);
    L.push('# HELP payrekha_shared_commit_ms Shared-commit wall time (this replica).', '# TYPE payrekha_shared_commit_ms summary');
    L.push(`payrekha_shared_commit_ms_sum ${s.commitMs.sum}`, `payrekha_shared_commit_ms_count ${s.commitMs.count}`, `payrekha_shared_commit_ms_max ${s.commitMs.max}`);
  }
  if (webhook !== undefined)
    metric('payrekha_webhooks_total', 'counter', 'Webhook deliveries.', [
      ['{result="sent"}', webhook.sent],
      ['{result="failed"}', webhook.failed],
      ['{result="dropped"}', webhook.dropped],
    ]);
  return L.join('\n') + '\n';
}
