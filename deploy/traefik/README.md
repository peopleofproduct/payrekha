# Traefik — forwardAuth to /ext_authz

Traefik's `forwardAuth` middleware is the integration point. It forwards
method/URI/headers to PayRekha and either lets the request through (200)
or returns the auth server's status (403 on HOLD/DECLINE).

```yaml
# docker-compose / dynamic config
labels:
  traefik.http.middlewares.payrekha.forwardauth.address: "http://payrekha:8080/ext_authz"
  traefik.http.middlewares.payrekha.forwardauth.authResponseHeaders: "x-payrekha-verdict,x-payrekha-action,x-payrekha-decision-id,x-payrekha-rules"
  traefik.http.middlewares.payrekha.forwardauth.authRequestHeaders: "authorization,x-client-id,x-forwarded-for"
  traefik.http.middlewares.payrekha.forwardauth.trustForwardHeader: "true"
  traefik.http.routers.payouts.middlewares: "payrekha"
```

Or static YAML:

```yaml
http:
  middlewares:
    payrekha:
      forwardAuth:
        address: http://payrekha:8080/ext_authz
        trustForwardHeader: true
        authResponseHeaders: [x-payrekha-verdict, x-payrekha-action, x-payrekha-decision-id, x-payrekha-rules]
        authRequestHeaders: [authorization, x-client-id, x-forwarded-for]
```

**Fail closed**: Traefik propagates the auth server's non-2xx — a HOLD or
DECLINE (or a gateway 5xx) denies the request. That is the desired
`failure_mode_allow: false` behaviour; a down PayRekha stops payouts.

Two caveats, same as every edge:

1. `forwardAuth` does **not** forward the body by default — verdicts see
   method/path/headers (+ your `authRequestHeaders`). Body-claim
   verification needs the headers the FieldMapping reads promoted into
   `authRequestHeaders`, or a small forward-auth shim that re-POSTs the body.
2. Assert `x-client-id` upstream of Traefik (edge authn), never from the
   request body — PayRekha trusts only what the proxy asserts.
