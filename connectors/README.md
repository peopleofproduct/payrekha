# PayRekha intent connectors — zero-code intents

Your system of record already emits "approved" events — LOS disbursal
approved, PA settlement ready, refund cleared. A connector consumes that
event and mints a managed intent at the gateway. **No code changes on the
sender side.**

Three transports, one shared field-map engine:

| Receiver | Run | Event arrives via |
|---|---|---|
| `webhook.mjs` | `npm run start:webhook` | HTTP POST (point your LOS/settlement webhook at `:8090`) |
| `kafka.mjs` | `npm run start:kafka` | consumer group; offset commits only after mint |
| `sqs.mjs` | `npm run start:sqs` | long-poll; delete only after mint |

## Config

```
PAYREKHA_URL=http://payrekha:8080        # gateway
PAYREKHA_MINT_TOKEN=<mint-role key>      # required
FIELD_MAP_FILE=fieldmaps/los-disbursal.json   # or FIELD_MAP='<inline json>'
```

- webhook: `BRIDGE_PORT` (8090), `BRIDGE_HOOK_SECRET` (`x-bridge-token` check), `BRIDGE_MAX_BODY`.
- kafka: `KAFKA_BROKERS`, `KAFKA_TOPIC`, `KAFKA_GROUP`, `KAFKA_SASL_*`, `KAFKA_SSL=1`, `KAFKA_FROM_BEGINNING=1`. Needs `npm i kafkajs` (optional peer) or the Dockerfile.
- sqs: `SQS_QUEUE_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN` (IRSA/env), `SQS_BATCH`, `SQS_VISIBILITY`. Zero AWS-SDK dep — SigV4 over node:crypto.

## Writing a fieldMap

Each leaf resolves against the incoming event:

```json
{
  "intentId": "loan.id",                             // dot-path; reuse your own id → retries collapse
  "kind":     { "const": "LOAN_DISBURSAL" },
  "amountPaise": "loan.amount_paise",
  "account":  "beneficiary.account_number",          // raw beneficiary is hashed at gateway entry
  "ifsc":     "beneficiary.ifsc",
  "subjectRef": "loan.id",
  "maxUses":  { "const": 1 },
  "ttlMs":    { "const": 86400000 },
  "notBeforeMs": { "coalesce": ["loan.payable_at", "loan.cooling_end_ms"] },
  "channel":  { "map": { "imps": "IMPS" }, "from": "loan.rail", "default": "INTERNAL" }
}
```

Spec leaves: `string` (dot-path), `{const}`, `{now:true}`, `{coalesce:[paths]}`,
`{map:{…}, from, default?}`, `{template:"{a}-{b}"}`. Reference maps in
`fieldmaps/` — start from one and edit fields, not code.

## Delivery semantics

At-least-once everywhere: Kafka offsets / SQS deletes happen **after** the
gateway accepts; mint is idempotent on `intentId`, so redelivery never
double-mints. Non-JSON SQS messages are deleted (poison pills would wedge
the queue); Kafka logs and holds (route a DLQ at the topic level).

## Container

```bash
docker build -t payrekha-connector connectors/
docker run -e CONNECTOR=sqs -e SQS_QUEUE_URL=… -e FIELD_MAP_FILE=/app/fieldmaps/pa-settlement.json \
  -e PAYREKHA_URL=… -e PAYREKHA_MINT_TOKEN=… payrekha-connector
```

## When NOT to use mint

Mint signs server-side — fine for pilots and low-trust-tier flows. In
production prefer signing in the SoR (`signIntent`/`signIntentWith` in
`@payrekha/client`, or the Java/Go/Python signers) and registering via
`POST /v1/intents`: the private key then never touches the connector or
the firewall host. The same fieldMap engine still applies — swap the sink.
