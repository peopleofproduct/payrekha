# NGINX / OpenResty — auth_request payout firewall

`deploy/nginx/payrekha.conf` puts a stock-NGINX `auth_request` gate on
`POST /payouts`: the subrequest hits PayRekha's `/ext_authz`, 200 proceeds
to the payout upstream, 403 (or any auth failure) stops it. Fail closed —
same posture as Envoy's `failure_mode_allow: false`.

## What the subrequest carries

`auth_request` is header-only in stock nginx, so the payout service must
assert the fields PayRekha maps — as response-to-request headers it sets
itself (`x-payrekha-intent`, `x-payout-kind`, `x-payout-amount`,
`x-payout-id`, `x-beneficiary-ref`). Your `payrekha.json` mapping reads
them under `header.*`:

```json
{
  "extAuthz": {
    "origin": "prod",
    "keySha256": "<sha256 hex of the shared key>",
    "mapping": {
      "payoutId": "header.x-payout-id",
      "kind": "header.x-payout-kind",
      "amountPaise": "header.x-payout-amount",
      "intentId": "header.x-payrekha-intent",
      "beneficiaryRef": "header.x-beneficiary-ref",
      "sourceKeyId": "header.x-client-id", // nginx asserts it — never forwarded
      "sourceHint": ["header.x-forwarded-for", "header.user-agent"]
    }
  }
}
```

`x-client-id` is set _by nginx_ (`proxy_set_header x-client-id
demo-payout-api`), never passed through — the caller must not name its own
key. `PAYREKHA_EXT_AUTHZ_KEY` reaches nginx via template/`nginx -e`, not a
literal in the conf.

## Body-level decisions — OpenResty

If the payout fields live in the JSON body rather than headers, stock
`auth_request` can't see them. The conf's commented OpenResty block runs
the same check in `access_by_lua_block` with `lua-resty-http`, forwarding
`ngx.req.get_body_data()` — the exact call Envoy makes. Fail closed on any
error. Needs OpenResty ≥1.19 or nginx + the lua module.

## Timeouts and degradation

`proxy_connect_timeout`/`proxy_read_timeout 0.25s` match the Envoy
0.25 s budget — a hung firewall must not stall the payout path. A timeout
→ 403 (fail closed). Alert on it: a denied-because-silence flood is the
availability signal (`payrekha_ready` / gateway `/readyz`).

## Validate

```bash
# shadow mode — everything 200s, decisions appear in the log only
curl -X POST localhost:8080/payouts -H 'content-type: application/json' \
  -H 'x-payout-id: po-1' -H 'x-payout-kind: REFUND' \
  -H 'x-payout-amount: 5000' -d '{"request_id":"po-1"}'
```
