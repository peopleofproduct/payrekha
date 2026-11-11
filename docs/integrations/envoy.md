# Envoy ext_authz

Adds PayRekha in front of an existing payout API with no code change. The full working stack is `deploy/docker-compose.yml` (Envoy :10000 → fake `/payouts` :9000, PayRekha :8080).

```yaml
http_filters:
  - name: envoy.filters.http.ext_authz
    typed_config:
      '@type': type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
      failure_mode_allow: false # PayRekha down = payout held
      with_request_body: { max_request_bytes: 65536, allow_partial_message: false }
      http_service:
        server_uri: { uri: payrekha:8080, cluster: payrekha, timeout: 0.25s }
        path_prefix: /ext_authz
        authorization_request:
          headers_to_add:
            - { key: authorization, value: 'Bearer <ext-authz token>' }
            # Envoy asserts the caller identity — a client-supplied
            # x-client-id must never reach this list. Derive it per-route
            # or from mTLS/JWT claims; fixed value only for a single tenant.
            - { key: x-client-id, value: '<payout-api-id>' }
          allowed_headers: { patterns: [{ prefix: x-payout- }, { exact: x-payrekha-intent }] }
        authorization_response:
          allowed_upstream_headers: { patterns: [{ prefix: x-payrekha- }] }
```

The ext_authz token authenticates Envoy itself (`PAYREKHA_EXT_AUTHZ_KEY`). Map your API's request to a payout with dot paths (`deploy/envoy/payrekha.json`):

```json
{
  "extAuthz": {
    "mapping": {
      "payoutId": "body.request_id",
      "kind": "header.x-payout-kind",
      "amountPaise": "body.amount_in_paise",
      "intentId": "header.x-payrekha-intent",
      "channel": "body.mode",
      "sourceKeyId": "header.x-client-id",
      "beneficiary": { "account": "body.beneficiary.account_number", "ifsc": "body.beneficiary.ifsc" }
    }
  }
}
```

Roots are `body.`, `header.`, `query.` and `path.`; `{ "const": "REFUND" }` sets a fixed value. Missing fields are not guessed: the payout becomes a degraded REVIEW. Raw beneficiary fields are hashed at the gateway and never logged.

Two trust rules the mapping cannot enforce for you:

- **`sourceKeyId` must come from a header Envoy sets** (`headers_to_add` or an auth-derived header), not one the client sends. A client that can name its own key can jump to a quieter velocity bucket or a nonprod origin. The demo `envoy.yaml` injects `x-client-id: demo-payout-api` and drops it from `allowed_headers` — copy that shape.
- **Caller clocks are evidence, not input.** If `mapping.timestampMs` resolves a client-controlled field, the value is recorded as `clientTimestampMs` and the check still runs at gateway time. Set `extAuthz.trustClientTimestamp` (and `firewall.maxTimestampSkewMs`) only when the upstream clock is genuinely trusted.
- **`sourceHint` is only as trustworthy as what feeds it.** `mapping.sourceHint` should resolve proxy-asserted values — `header.x-envoy-external-address`, `header.user-agent`, an auth-derived claim — never a body field or a header the client can write (strip client-sent `x-forwarded-for` upstream). An array composes parts (`["header.x-envoy-external-address", "header.user-agent"]` → `ip|ua`). It feeds `identity.fingerprint`, and lands in the decision log / CEF `src`.
- **Multi-approval kinds take `mapping.approvalIds`** — an array path or a comma-joined header (`header.x-payrekha-approvals`) listing the extra registered intent ids `firewall.requiredApprovals` demands.

Responses: in `shadow`, always 200 with `x-payrekha-verdict` set to the real verdict. In `enforce`, a `HOLD` or `DECLINE` returns 403 with `x-payrekha-verdict`, `x-payrekha-action`, `x-payrekha-decision-id` and `x-payrekha-rules`.
