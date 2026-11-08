# Roadmap

Alpha now. What was "next" has mostly shipped — this is what's actually
left, roughly in order. Nothing here is a promise of dates.

## Shipped since this file last said "planned"

- **Clients:** Spring Boot starter, .NET, Go, Python, plus Ruby/PHP/Rust signers.
- **Gateways:** Envoy, NGINX/OpenResty, Kong, Istio, Traefik, AWS API Gateway, Apigee — plus an Express middleware.
- **Stores:** Postgres shared-state for active-active replicas (ADR 0004). A Redis/MySQL `SharedStateBackend` is possible via the seam but Postgres-first is deliberate.
- **Operations console:** shipped — `GET /console` on the gateway.
- **Everything else:** `docs/production-readiness-plan.md` is the live ledger — ~30 of 33 items done.

## Still open (in-repo)

- **Canaries:** more canary types (decoy API keys in config repos, decoy merchant IDs, honey intents in LOS exports).
- **Engine:** converge on one shared engine with [Krediwall](https://github.com/peopleofproduct/krediwall) (see [ADR 0001](docs/adr/0001-engine.md)).
- **Contract-thin adapters** the spec already supports: Elixir/Kotlin signers, HAProxy, Pulsar/gRPC receivers, Fastify/Rails/Django wrappers, AMI builds.

## Outside the repo

- **E2 external security review** — the audit pack is ready to hand a reviewer.
- **E4 design-partner pilots** — `payrekha init` + kits are the on-ramp.
- **D5 certifications** (SOC2/ISO) — an org engagement.

Core and rules have zero runtime dependencies and make no network calls. CI checks both.
State is bounded (LRU maps, ring buffers). Snapshots are written atomically with mode `0600`. Restoring a snapshot never changes the configured mode.
`npm run bench` on Node 24 (laptop): in-process p50 10 µs, p99 19 µs; gateway p99 0.73 ms over loopback. CI fails on a large regression.
