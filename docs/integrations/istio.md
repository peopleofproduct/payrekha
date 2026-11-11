# Istio — PayRekha via ext_authz

PayRekha speaks the Envoy `ext_authz` HTTP API — which is exactly what
Istio's `CUSTOM` authorization action calls. Wire it as a mesh
`extensionProvider` and scope it to the payout workload; no PayRekha
changes needed.

## 1. Register the provider (mesh config)

```yaml
# istio install / MeshConfig
extensionProviders:
  - name: payrekha
    envoyExtAuthzHttp:
      service: payrekha.payrekha.svc.cluster.local
      port: 8080
      pathPrefix: /ext_authz
      timeout: 0.25s
      failOpen: false # ← fail closed, same as everywhere
      includeRequestBodyInCheck: { maxRequestBytes: 65536, allowPartialMessage: false }
      headersToUpstreamOnAllow: [x-payrekha-decision-id]
      headersToDownstreamOnDeny: [x-payrekha-verdict, x-payrekha-action, x-payrekha-decision-id]
```

## 2. Authorize only the payout route

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata: { name: payrekha-payouts, namespace: payouts }
spec:
  selector: { matchLabels: { app: payout-api } }
  action: CUSTOM
  provider: { name: payrekha }
  rules:
    - to: [{ operation: { methods: ['POST'], paths: ['/payouts*'] } }]
```

## 3. Mapping + caller identity

`mapping` in `payrekha.json` reads the forwarded body/headers the same as
plain Envoy (`deploy/envoy/envoy.yaml` is the reference). Two differences
to respect:

- **`x-client-id`** — Istio won't inject it for you. Assert the caller
  identity from `source.principal` (mTLS) via a Lua/Wasm filter or a
  `headersToUpstreamOnAllow` static value; it must never come from a
  client-writable header.
- **`sourceHint`** — map `header.x-forwarded-for`; Istio populates XFF the
  same way Envoy does.

## Notes

- `timeout: 0.25s` matches the reference Envoy budget; `failOpen: false`
  is the default and must stay — a denied check is a denied payout.
- The same sidecar pattern works for gateways (Gloo, Contour) that wrap
  Envoy ext_authz — point `pathPrefix` at `/ext_authz` and reuse the
  quickstart mapping.
