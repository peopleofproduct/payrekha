export interface PayrekhaMiddlewareOptions {
  /** PayrekhaClient instance (baseUrl + apiKey configured). */
  readonly client: { evaluate(p: Record<string, unknown>): Promise<{ effectiveAction: string; verdict: string; decisionId: string; hits: { rule: string }[] }> };
  /** Build the payout request from the Express request. Default maps common field names. */
  readonly map?: (req: unknown) => Record<string, unknown>;
  /** Called on HOLD/DECLINE before responding — return false to suppress the default 403. */
  readonly onDeny?: (verdict: { effectiveAction: string; verdict: string; decisionId: string; hits: { rule: string }[] }, req: unknown, res: unknown) => boolean | void;
}
export declare function payrekhaMiddleware(opts: PayrekhaMiddlewareOptions): (req: unknown, res: unknown, next: (e?: unknown) => void) => void;
