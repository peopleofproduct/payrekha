# Stack compatibility — what plugs in today, what needs a recipe

The architecture's contract is deliberately minimal: **HTTPS POST + an
Ed25519 signing spec + a Prometheus text endpoint.** Any stack that can
do those three things integrates — so nothing is fundamentally
incompatible. This page splits "works out of the box" from "works via
the documented contract" from "needs a shipped adapter we haven't built."

## Enforcement point (where a BLOCK actually stops the call)

| Stack | Status | Path |
|---|---|---|
| Envoy / Istio | ✅ shipped | `deploy/envoy/` ext_authz + `docs/integrations/istio.md`; prod fails closed |
| NGINX / OpenResty | ✅ shipped | `deploy/nginx/payrekha.conf` (auth_request + Lua body variant) |
| Kong | ✅ shipped | `deploy/kong/plugins/payrekha/` Lua plugin |
| Spring Boot (no proxy) | ✅ shipped | `@PayrekhaCheck` AOP — `clients/java-spring` |
| Express/Connect | ✅ shipped | `clients/js/express.js` middleware — fails closed, verdict on `req.payrekha` |
| Fastify/Rails/Django | ⚠️ contract | ~30-line handler over `/v1/evaluate`; not yet a shipped package |
| Traefik | ✅ shipped | `deploy/traefik/README.md` — forwardAuth, fail closed |
| HAProxy | ⚠️ contract | no native ext-auth; front it with Envoy |
| **Apigee** | ✅ shipped | `deploy/apigee/` — ServiceCallout + RaiseFault recipe |
| **AWS API Gateway** | ✅ shipped | `deploy/aws-apigw/` — REQUEST Lambda authorizer, fails closed |
| Cloudflare Workers, Azure APIM | ⚠️ contract | Contract-compatible, no adapter — the Lambda authorizer is the reference |

## Intent signing (the system of record)

| Language | Status | Conformance |
|---|---|---|
| JS/TS, Java, Spring, .NET, Go, Python | ✅ shipped + byte-identical | All pass `clients/vectors/intent-v1.json` |
| Ruby, PHP, Rust | ✅ shipped | `clients/ruby|php|rust/` — canonicalJson+signIntent, ~80 lines each |
| Elixir, Kotlin | ⚠️ spec-only | ~100 lines each; canonical JSON is deliberately boring for exactly this |

## Ingestion (managed intents from source systems)

| Source | Status |
|---|---|
| Generic webhook, Kafka, SQS | ✅ shipped — `connectors/` + field-map engine; LOS + PA reference maps included |
| RabbitMQ, Kinesis | ✅ shipped | `connectors/rabbitmq.mjs` (amqplib, DLX-nack) + `connectors/kinesis.mjs` (zero-dep SigV4) |
| Pulsar, gRPC, DB CDC | ⚠️ a receiver + fieldmap JSON away — same `bridge`/`fieldmap` core |

## State backend

| Backend | Status |
|---|---|
| File/config (single), Postgres (active-active), memory (drill) | ✅ shipped |
| MySQL, Redis, DynamoDB | ⚠️ `SharedStateBackend` seam is the extension point; Postgres-first is deliberate |

## Secrets & key management

| Provider | Status |
|---|---|
| Env vars / ExternalSecret (ESO) / files | ✅ shipped |
| AWS KMS, GCP Cloud KMS, PKCS#11 HSM | ✅ shipped — `@payrekha/client/kms` |
| Azure Key Vault, Vault transit | ✅ shipped | `azureKeyVaultSigner` + `vaultTransitSigner` in `@payrekha/client/kms` |

## Observability

| Stack | Status |
|---|---|
| Prometheus + Grafana (dashboard + alerts) | ✅ shipped, two-click import |
| Datadog, New Relic, OTel collector, managed Prom | ✅ scrape configs — `docs/integrations/observability.md` |
| Splunk, Sentinel, Elastic | ✅ query packs + Vector shipper — `deploy/siem/` |
| CloudWatch, Loki | ✅ shipped | configs in `docs/integrations/observability.md` |

## Deployment

| Substrate | Status |
|---|---|
| Docker, compose | ✅ shipped |
| Kubernetes (Helm: single/standby/active-active, PDB, NetPol, PDB, ServiceMonitor) | ✅ shipped |
| Bare Node ≥ 20 | ✅ `node dist/bin.js` — zero runtime deps |
| ECS/Fargate | ✅ shipped | `deploy/terraform/ecs/` — single-writer module with circuit breaker |
| VM images (AMI) | ⚠️ container is portable; no shipped packer |
| Serverless/Lambda | ❌ wrong fit — the firewall is a stateful long-running process by design |

## The honest summary

- **Plug-and-play today**: k8s or compose deploys behind Envoy/NGINX/
  Kong/Istio, system-of-record in JS/Java/.NET/Go/Python, webhooks or
  Kafka/SQS ingestion, Postgres or file state, any Prometheus-compatible
  observability stack. That covers the majority of real BFSI stacks.
- **Contract-compatible (works, but you write the thin adapter)**: other
  languages (~100-line signer), other proxies (forward-auth hook), other
  queues (receiver + fieldmap), Vault/Azure keys (signer interface).
- **Remaining contract-only surfaces**: Elixir/Kotlin signers, HAProxy,
  Pulsar/gRPC/DB-CDC receivers, Cloudflare/Azure-APIM adapters, Fastify/
  Rails/Django middleware packages, AMI builds. All contract-compatible;
  a shipped adapter is a small file away.
- **By-design non-goal**: serverless deployment — a payout firewall is
  stateful by definition.

When evaluating a stack not listed here the question is one-line: *can it
POST JSON to a sidecar, and can its signing side hold an Ed25519 key or
call a KMS?* If yes, it integrates.
