# Envoy ext_authz

Adds Payrekha in front of an existing payout API with no code change. The full working stack is `deploy/docker-compose.yml` (Envoy :10000 → fake `/payouts` :9000, Payrekha :8080).

```yaml
http_filters:
  - name: envoy.filters.http.ext_authz
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
      failure_mode_allow: false          # Payrekha down = payout held
      with_request_body: { max_request_bytes: 65536, allow_partial_message: false }
      http_service:
        server_uri: { uri: payrekha:8080, cluster: payrekha, timeout: 0.25s }
        path_prefix: /ext_authz
        authorization_request:
          headers_to_add: [{ key: authorization, value: "Bearer <ext-authz token>" }]
          allowed_headers: { patterns: [{ prefix: x-payout- }, { exact: x-payrekha-intent }, { exact: x-client-id }] }
        authorization_response:
          allowed_upstream_headers: { patterns: [{ prefix: x-payrekha- }] }
```

The ext_authz token authenticates Envoy itself (`PAYREKHA_EXT_AUTHZ_KEY`). Map your API's request to a payout with dot paths (`deploy/envoy/payrekha.json`):

```json
{ "extAuthz": { "mapping": {
  "payoutId": "body.request_id", "kind": "header.x-payout-kind", "amountPaise": "body.amount_in_paise",
  "intentId": "header.x-payrekha-intent", "channel": "body.mode", "sourceKeyId": "header.x-client-id",
  "beneficiary": { "account": "body.beneficiary.account_number", "ifsc": "body.beneficiary.ifsc" } } } }
```

Roots are `body.`, `header.`, `query.` and `path.`; `{ "const": "REFUND" }` sets a fixed value. Missing fields are not guessed: the payout becomes a degraded REVIEW. Raw beneficiary fields are hashed at the gateway and never logged.

Responses: in `shadow`, always 200 with `x-payrekha-verdict` set to the real verdict. In `enforce`, a `HOLD` or `DECLINE` returns 403 with `x-payrekha-verdict`, `x-payrekha-action`, `x-payrekha-decision-id` and `x-payrekha-rules`.
