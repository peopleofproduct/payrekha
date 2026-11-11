# Express / Connect-style middleware — trial integration guide

**Time to first verdict: ~15 minutes.** For stacks without a proxy, the
middleware calls `/v1/evaluate` in-band — the payout handler only runs on
ALLOW.

## Step 1 — run PayRekha

```sh
npm run init && cd <out> && docker compose --env-file .env up -d
```

## Step 2 — install + wire

```sh
npm i @payrekha/client
```

```js
import { PayrekhaClient } from '@payrekha/client';
import { payrekhaMiddleware } from '@payrekha/client/express';

const client = new PayrekhaClient({
  baseUrl: 'http://payrekha:8080',
  apiKey: process.env.PAYREKHA_EVAL_KEY, // an evaluate-role key
});

app.post('/payouts', payrekhaMiddleware({ client }), payoutHandler);
```

The default `map` reads `payoutId|id|x-idempotency-key`, `kind`,
`amountPaise`, `channel`, `intentId|x-payrekha-intent`, `merchantId`,
`beneficiary`, `timestampMs` from `req.body`/headers — pass a `map(req)`
when your payload shape differs.

## Step 3 — verify

```sh
curl -i localhost:3000/payouts -d '{"id":"t1","amount":99999,"beneficiary":"x@bank"}'
# unsigned → BLOCK → 403 { error, verdict, decisionId, rules }
```

`req.payrekha` carries the full verdict into `payoutHandler` — log it,
attach `decisionId` to your own records.

## Behaviour contract

- **Fail closed**: gateway unreachable → `next(err)` → your error handler
  returns 5xx — the payout never runs (matches `failure_mode_allow:false`).
- **Shadow needs nothing here**: server-side mode makes
  `effectiveAction` `ALLOW` even for BLOCK verdicts — the middleware
  passes through, but the verdict is still in `req.payrekha` + the
  decision log. Ideal for instrumenting without blocking.
- **onDeny(v, req, res)**: return `false` to handle the deny yourself
  (e.g. queue-for-review instead of 403 in `advise`).

## Non-Express frameworks

Fastify: same call inside `preHandler`. Rails/Django: the contract is
identical — evaluate before the handler, deny on non-ALLOW, fail closed.
