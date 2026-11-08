# Apigee — trial integration guide

**Time to first verdict: ~30 minutes.** The pattern: a `ServiceCallout`
in the PreFlow POSTs to `/ext_authz`; `RaiseFault` on non-200 denies.

## Prerequisites

- PayRekha reachable from Apigee's runtime — trial path: `npm run init`
  output behind an HTTPS TargetServer, or a Private Service Connect
  endpoint for SaaS Apigee.
- The ext_authz shared key (`x-payrekha-key`) — store it in a KVM, never
  hardcoded (`payrekha.sharedkey` reference below).

## Step 1 — run PayRekha

```sh
npm run init && cd <out> && docker compose --env-file .env up -d
```

## Step 2 — proxy pieces (in order)

1. **TargetServer** `payrekha-gw` → `https://<host>:8080` (TLS; payrekha's
   own cert or terminate at your LB).
2. **KVM** `payrekha-config` → `payrekha.sharedkey`, `payrekha.baseurl`.
3. **ServiceCallout** `SC-Payrekha-ExtAuthz` — copy
   `deploy/apigee/README.md`'s XML verbatim.
4. **RaiseFault** `RF-Payrekha-Deny` → status 403, payload
   `{"error":"payout denied","decisionId":"{payrekhaResponse.header.x-payrekha-decision-id}"}`.

## Step 3 — PreFlow wiring

```xml
<PreFlow>
  <Request>
    <Step><Name>SC-Payrekha-ExtAuthz</Name></Step>
    <Step><Condition>payrekhaResponse.status.code != 200</Condition>
      <Name>RF-Payrekha-Deny</Name></Step>
  </Request>
</PreFlow>
```

Attach to the payout flows only — a health route shouldn't pay an
authz call.

## Step 4 — verify

```sh
curl -i https://<org>-<env>.apigee.net/payouts -d '{"id":"t1","amount":99999}'
# → 403 + the decision id; decision lands in PayRekha's log/console
```

## Graduate + caveats

- **Fail closed by construction**: timeout/5xx → `success.codes` (200 only)
  fails → `!= 200` → RaiseFault. A dead PayRekha stops payouts — correct.
- **Source identity**: `x-client-id` must come from an Apigee VerifyApiKey/
  OAuth policy upstream — never from the request body.
- **Body claims**: the ServiceCallout forwards method+URI+headers. For
  beneficiary/amount claims, extract them with AssignMessage into the
  headers the FieldMapping reads (or put Envoy in front for full-body
  verification).
- Shadow → advise → enforce is server-side (`PUT /v1/state`) — no
  Apigee change needed.
