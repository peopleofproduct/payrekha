# Trial playbook — pick your stack, get a verdict in 30 minutes

Every stack guide below follows the same shape: **run PayRekha → wire
your edge/app → send a bad payout → watch it BLOCK → graduate modes**.
The universal sandbox is the `payrekha init` wizard — one command makes
a complete shadow stack.

## The 5-minute sandbox (all stacks)

```sh
npm run init            # pick your segment (lender/PA/PSP/crypto) + tier
cd <out-dir> && docker compose --env-file .env up -d
curl localhost:8080/readyz     # ready
open http://localhost:8080/console   # the triage UI (read key from .env)
```

That gives you: the gateway in **shadow** (records verdicts, blocks
nothing), Envoy + Prometheus wired, a segment-tuned `payrekha.json`, your
Ed25519 issuer keys, and a calendar. Everything below starts from it.

## Pick your surface

### Edge / proxy (payrolls stop at the proxy — strongest posture)

| Stack             | Guide                            | Model                       |
| ----------------- | -------------------------------- | --------------------------- |
| Envoy             | `docs/integrations/envoy.md`     | ext_authz filter            |
| NGINX / OpenResty | `docs/integrations/nginx.md`     | auth_request / Lua          |
| Kong              | `docs/integrations/kong.md`      | `payrekha` plugin           |
| Istio             | `docs/integrations/istio.md`     | CUSTOM AuthorizationPolicy  |
| Traefik           | `docs/integrations/traefik.md`   | forwardAuth middleware      |
| AWS API Gateway   | `docs/integrations/aws-apigw.md` | REQUEST Lambda authorizer   |
| Apigee            | `docs/integrations/apigee.md`    | ServiceCallout + RaiseFault |

### In-process (no proxy — the app evaluates inline)

| Stack           | Guide                                           | Model                |
| --------------- | ----------------------------------------------- | -------------------- |
| Express/Node    | `docs/integrations/express.md`                  | `payrekhaMiddleware` |
| Spring Boot     | `docs/integrations/java-spring.md`              | `@PayrekhaCheck`     |
| Any HTTP client | `docs/integrations/node.md` `go.md` `python.md` | `POST /v1/evaluate`  |

### Signing (the system of record)

| Language                                   | Client                                                              |
| ------------------------------------------ | ------------------------------------------------------------------- |
| JS/TS · Java · Spring · .NET · Go · Python | `clients/` — all vector-conformant                                  |
| Ruby · PHP · Rust                          | `clients/ruby                                                       | php | rust/` signers |
| Other                                      | `clients/vectors/intent-v1.json` + the canonical rules — ~100 lines |

### Intents from source systems

`connectors/` — webhook, Kafka, SQS, RabbitMQ, Kinesis + field-map engine
(LOS + PA reference maps). KMS/HSM signing: `docs/kms.md` (AWS, GCP,
Azure, Vault, PKCS#11).

## The trial's pass criteria

1. **Bad payout BLOCKs** — unsigned/over-ceiling/expired intent →
   `BLOCK`, visible in `GET /console` and `decisions.jsonl`.
2. **Fail-closed proof** — stop the gateway; the payout path must deny
   (every integration above is built that way).
3. **A week of shadow** — let it watch real traffic; tune thresholds
   from `report.html`'s `suggested.config` or a kit preset.
4. **Graduate** — `PUT /v1/state {"mode":"advise"}` → per-kind
   `"enforce"`. The integration needs no change — `effectiveAction`
   drives the deny.

## What a trial is NOT

- Not production keys — the wizard's `issuer-keys.json` is a trial pair.
- Not your SIEM yet — ship `decisions.jsonl` to the SOC in week 2
  (`docs/integrations/siem.md`).
- Not enforce-on-day-one — shadow's whole job is measuring FP rate
  before a real payout can be held (`docs/ga-criteria.md` G2).
