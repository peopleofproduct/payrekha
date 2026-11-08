# AWS API Gateway — trial integration guide

**Time to first verdict: ~30 minutes.** The pattern: a REQUEST Lambda
authorizer calls PayRekha's `/ext_authz`; a Deny policy stops the payout.

## Prerequisites

- A PayRekha instance reachable from Lambda's network — for a trial, the
  `payrekha init` output on a private EC2/ECS box, or an internal NLB in
  front of the container.
- An ext_authz shared key (`PAYREKHA_API_KEYS` entry or
  `extAuthz.keySha256` — see `docs/operations.md`).

## Step 1 — run PayRekha (5 min)

```sh
npm run init                 # segment: your segment, tier: external
cd <out> && docker compose --env-file .env up -d
curl localhost:8080/readyz   # → ready
```

Note the generated `PAYREKHA_API_KEYS` read/evaluate entries — the
authorizer needs the ext_authz shared key (`x-payrekha-key`), which is
`extAuthz.keySha256`'s plaintext in `payrekha.json`, or a dedicated
`/ext_authz` key pair you add.

## Step 2 — deploy the authorizer (10 min)

```sh
cd deploy/aws-apigw
zip authorizer.zip authorizer.py
aws lambda create-function --function-name payrekha-authz \
  --runtime python3.12 --handler authorizer.handler \
  --zip-file fileb://authorizer.zip --role <lambda-exec-role-arn> \
  --environment "Variables={PAYREKHA_URL=https://payrekha.internal:8080,PAYREKHA_KEY=<shared-key>}"
```

- Lambda must reach PayRekha — attach it to the VPC + an SG with egress
  to the gateway (or PrivateLink). A Lambda without egress fails closed —
  every call Denies.
- Timeout: authorizer hard-times at `PAYREKHA_TIMEOUT_S` (default 2s);
  keep the API's authorizer timeout above it.

## Step 3 — attach to the API (5 min)

```sh
aws apigatewayv2 create-authorizer --api-id <api> --name payrekha \
  --authorizer-type REQUEST --authorizer-uri arn:aws:apigateway:…:lambda:path/…/invocations \
  --authorizer-payload-format-version 2.0 --enable-simple-responses \
  --identity-source '$request.header.Authorization'
aws apigatewayv2 update-route --api-id <api> --route-id <payout-route> \
  --authorization-type CUSTOM --authorizer-id <authz-id>
```

**Do not enable authorizer caching** — verdicts are per-request.

## Step 4 — verify the trial

```sh
# unsigned payout → PayRekha BLOCKs → authorizer Denies → 403
curl -i https://<api>.execute-api…/payouts -d '{"id":"t1","amount":99999}'
# expected: 403 — check PayRekha's decisions.jsonl / console for the rule hits
```

## Graduate

shadow (default) records verdicts without stopping traffic — watch the
console/`payrekha_verdicts_total` for a week, tune kit thresholds, then
`PUT /v1/state {"mode":"advise"}` → `"enforce"` per kind. The authorizer
needs no change — `effectiveAction` drives Deny.

## Failure behaviour

Lambda error, PayRekha unreachable, or timeout → **Deny** (fail closed).
`context` carries `verdict/action/decisionId/rules` to the backend for
logging on both paths.
