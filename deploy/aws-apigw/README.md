# AWS API Gateway — REQUEST Lambda authorizer

API Gateway can't call arbitrary ext_authz endpoints — a **REQUEST
authorizer Lambda** is the integration point. It calls PayRekha's
`/ext_authz` and returns an Allow/Deny IAM policy. Verdict headers map to
authorizer context so the backend sees them.

## Deploy

1. `authorizer.py` — zip and deploy as a `REQUEST` authorizer with
   `identitySources` on the payout route (include `method.request.header.Authorization`
   or an API-key header).
2. Env: `PAYREKHA_URL` (gateway base), `PAYREKHA_KEY` (the ext_authz
   shared key), optional `PAYREKHA_PATH_MAP` (see the file).
3. The Lambda needs egress to PayRekha — VPC + security group or a
   privateLink endpoint; keep the authorizer timeout under the payout
   path's budget (authorizer.py uses a 2s deadline).
4. **Fail closed**: on any PayRekha error the authorizer returns `Deny`
   — matching `failure_mode_allow: false` semantics. Cache policy is
   left off deliberately (`TTL=0`) — verdicts must be per-request.

The payout body reaches PayRekha via the authorizer's `context` passthrough
only if the event carries it — for strictest enforcement (body-claim
verification) front API Gateway with the Envoy/nginx recipe instead.
