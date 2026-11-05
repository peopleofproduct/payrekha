// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { createHmac } from 'node:crypto';

export interface WebhookOptions {
  /** Your SOAR / incident endpoint. Payrekha calls nothing else. */
  readonly url: string;
  /** HMAC-SHA256 key; receivers verify `x-payrekha-signature`. */
  readonly secret: string;
  readonly retries?: number;
  readonly timeoutMs?: number;
  readonly maxQueue?: number;
}

export type WebhookEvent =
  | { readonly type: 'alert.entered' | 'alert.cleared'; readonly atMs: number; readonly actor: string; readonly reason: string }
  | { readonly type: 'payout.blocked'; readonly atMs: number; readonly decisionId: string; readonly payoutId: string; readonly rules: readonly string[]; readonly mode: string; readonly effectiveAction: string };

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/**
 * Fire-and-forget sender with a bounded queue, retries and exponential
 * backoff. `send()` returns immediately; the verdict never waits on it.
 */
export class WebhookSender {
  private readonly queue: WebhookEvent[] = [];
  private running = false;
  sent = 0;
  failed = 0;
  dropped = 0;

  constructor(
    private readonly o: WebhookOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  send(e: WebhookEvent): void {
    if (this.queue.length >= (this.o.maxQueue ?? 1_000)) {
      this.dropped += 1;
      return;
    }
    this.queue.push(e);
    if (!this.running) void this.drain();
  }

  async idle(): Promise<void> {
    while (this.running || this.queue.length > 0) await new Promise((r) => setTimeout(r, 5));
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      for (let e = this.queue.shift(); e !== undefined; e = this.queue.shift()) await this.deliver(e);
    } finally {
      this.running = false;
    }
  }

  private async deliver(e: WebhookEvent): Promise<void> {
    const body = JSON.stringify(e);
    const retries = this.o.retries ?? 3;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ts = String(Date.now());
      try {
        const res = await this.fetchImpl(this.o.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-payrekha-timestamp': ts, 'x-payrekha-signature': signWebhook(this.o.secret, ts, body) },
          body,
          signal: AbortSignal.timeout(this.o.timeoutMs ?? 3_000),
        });
        if (res.ok) {
          this.sent += 1;
          return;
        }
      } catch {
        /* retry */
      }
      if (attempt < retries) await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
    this.failed += 1;
  }
}
