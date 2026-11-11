# Kong — payrekha plugin

`deploy/kong/plugins/payrekha` is a Kong plugin that runs the same
`/ext_authz` authorization Envoy does: in `access`, every POST to the
route is checked against PayRekha before it reaches the payout upstream.
`200` proceeds; anything else — `403` verdict, timeout, connection error —
stops the request. **Fail closed**: a PayRekha silence never lets money move.

## Install

```bash
# mount the plugin dir and declare it
kong.conf: plugins = bundled,payrekha
           lua_package_path = /opt/kong/plugins/?.lua;;
# then attach to the payout route/service
curl -X POST kong-admin:8001/services/payout-api/plugins \
  --data name=payrekha \
  --data config.payrekha_url=http://payrekha:8080 \
  --data config.ext_authz_key=$PAYREKHA_EXT_AUTHZ_KEY \
  --data config.source_key_id=payout-api \
  --data config.forward=body
```

The plugin needs `lua-resty-http` (bundled with Kong ≥3.x). For DB-less
deploys the same block goes in `declarative_config` under `plugins:`.

## Config

| Field            | Default    | Notes                                                                                                                     |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `payrekha_url`   | required   | gateway base URL                                                                                                          |
| `ext_authz_key`  | required   | sent as `x-payrekha-key`; keep it in Kong vaults/env, not config files                                                    |
| `source_key_id`  | required   | asserted caller identity — set here, never read from the client                                                           |
| `forward`        | `body`     | `body` = full JSON forwarded (Envoy parity); `headers` = only the `x-payrekha-*`/`x-payout-*`/`x-beneficiary-ref` headers |
| `timeout_ms`     | `250`      | matches the Envoy budget; timeout → deny                                                                                  |
| `payout_path`    | `/payouts` | appended to `/ext_authz` so path-mapped rules see the real route                                                          |
| `on_unavailable` | `deny`     | only value — there is no allow-on-outage                                                                                  |

With `forward=body`, `mapPayout` reads `body.*` exactly like Envoy; with
`forward=headers` the service asserts `x-payout-*`/`x-payrekha-intent`
headers (NGINX parity). `x-client-id` and `x-forwarded-for` are asserted
by Kong (`kong.client.get_forwarded_ip()`), never client-writable.

## Semantics worth knowing

- GET/HEAD pass ungated — only POSTs move money.
- The decision id is relayed to the upstream as `x-payrekha-decision-id`
  for the payout ledger's join, and back to the caller on 403s.
- Shadow mode: `/ext_authz` still returns 200 for everything (the verdict
  is logged) — the plugin needs no mode awareness.

## Validate

```bash
curl -X POST kong:8000/payouts -d '{"request_id":"po-1","amount_in_paise":5000}'
# → 403 {"verdict":"BLOCK", …} once enforce is on; 200 in shadow
```
