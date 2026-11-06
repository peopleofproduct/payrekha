# @payrekha/gateway

The reference HTTP control plane for [PayRekha](https://github.com/peopleofproduct/payrekha): bearer-key auth with role-scoped keys (`evaluate`/`outcomes`/`intents`/`mint`/`read`), Envoy `ext_authz` adapter, decision log (JSONL/CEF), Prometheus metrics, signed webhooks, state lifecycle and admin surface.

```bash
payrekha-gateway            # boots from env — see docs/operations.md
```

Key envs: `PAYREKHA_CONFIG`, `PAYREKHA_API_KEYS` (`id:prod|nonprod[:roles]:token`),
`PAYREKHA_ADMIN_KEY`, `PAYREKHA_HASH_KEY`, `PAYREKHA_STATE_FILE` or
`PAYREKHA_STATE_PG_URL`, `PAYREKHA_STATE_KEY`, `PAYREKHA_MINT_KEY(_ID)`.

Routes: `POST /v1/evaluate`, `POST /v1/intents`, `POST /v1/intents/mint`,
`POST /v1/outcomes`, `GET|PUT /v1/state`, `GET /v1/decisions`,
`GET /v1/audit`, `GET /v1/intents/{id}`, `POST /v1/canaries`,
`DELETE /v1/issuers/{keyId}`, `/healthz`, `/readyz`, `/metrics`,
`/ext_authz/*` — see `docs/api/openapi.yaml`.

Embed it with `createGateway`/`bootFromEnv`, or run the binary — non-root,
read-only-FS friendly (`deploy/Dockerfile`).

Apache-2.0.
