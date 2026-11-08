# Traefik — trial integration guide

**Time to first verdict: ~15 minutes.** Traefik's `forwardAuth`
middleware POSTs to `/ext_authz`; a non-2xx stops the request — fail
closed by default.

## Step 1 — run PayRekha

```sh
npm run init && cd <out> && docker compose --env-file .env up -d
```

## Step 2 — add the middleware

Docker labels on your payout service:

```yaml
labels:
  traefik.http.middlewares.payrekha.forwardauth.address: "http://payrekha:8080/ext_authz"
  traefik.http.middlewares.payrekha.forwardauth.authResponseHeaders: "x-payrekha-verdict,x-payrekha-action,x-payrekha-decision-id,x-payrekha-rules"
  traefik.http.middlewares.payrekha.forwardauth.authRequestHeaders: "authorization,x-client-id,x-forwarded-for"
  traefik.http.middlewares.payrekha.forwardauth.trustForwardHeader: "true"
  traefik.http.routers.payouts.middlewares: "payrekha"
```

(File provider: the static-YAML version is in `deploy/traefik/README.md`.)

## Step 3 — verify

```sh
curl -i http://traefik/payouts -H 'x-client-id: trial' -d '{"id":"t1","amount":99999}'
# unsigned → BLOCK → 403; x-payrekha-* verdict headers ride back to your app
```

## What to know

- **Body isn't forwarded** — verdicts see method/URI/headers. Promote
  the fields your `FieldMapping` needs into `authRequestHeaders` (or use
  Envoy for body-claim verification).
- **`trustForwardHeader: true`** only if Traefik is the entrypoint —
  otherwise a caller spoofs `x-forwarded-for`.
- **Fail closed**: PayRekha down → Traefik returns its error — payouts
  stop. That is the production posture; a trial can verify it by stopping
  the gateway and watching payout calls 5xx.
- Shadow → advise → enforce is server-side (`PUT /v1/state`).
