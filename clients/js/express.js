// Express/Connect-style middleware — the ~30 lines most Node adopters
// would otherwise hand-write. Fails CLOSED: a gateway error denies the
// request (match Envoy's failure_mode_allow:false). For shadow, set
// mode:'shadow' server-side — effectiveAction comes back ALLOW.
//
//   app.post('/payouts', payrekhaMiddleware({ client }), handler);
export function payrekhaMiddleware({ client, map, onDeny }) {
  const mapFn =
    map ??
    ((req) => {
      const b = req.body ?? {};
      return {
        payoutId: b.payoutId ?? b.id ?? req.get?.('x-idempotency-key'),
        kind: b.kind ?? 'VENDOR_PAYOUT',
        amountPaise: b.amountPaise ?? b.amount_paise,
        channel: b.channel,
        intentId: b.intentId ?? req.get?.('x-payrekha-intent'),
        merchantId: b.merchantId,
        beneficiary: b.beneficiary,
        timestampMs: b.timestampMs,
      };
    });
  return (req, res, next) => {
    client
      .evaluate(mapFn(req))
      .then((v) => {
        req.payrekha = v; // verdict evidence on the request for downstream handlers
        if (v.effectiveAction === 'ALLOW') return next();
        if (onDeny && onDeny(v, req, res) === false) return;
        res.status(403).json({ error: 'payout denied by payrekha', verdict: v.verdict, decisionId: v.decisionId, rules: v.hits.map((h) => h.rule) });
      })
      .catch((e) => next(Object.assign(new Error('payrekha unreachable — denying'), { cause: e })));
  };
}
