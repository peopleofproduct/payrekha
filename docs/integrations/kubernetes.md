# Kubernetes

The Helm chart is in [`deploy/helm/payrekha`](../../deploy/helm/payrekha). It runs the gateway as UID 1000 on a read-only root filesystem with all capabilities dropped, no service-account token, a `RuntimeDefault` seccomp profile and a NetworkPolicy. It starts in shadow mode.

```bash
# 1. Secrets stay out of values.yaml: create them yourself.
kubectl create secret generic payrekha \
  --from-literal=PAYREKHA_API_KEYS='payout-svc:prod:evaluate+outcomes:<token ≥16 chars>,los:prod:intents:<token>' \
  --from-literal=PAYREKHA_ADMIN_KEY='<admin token>' \
  --from-literal=PAYREKHA_HASH_KEY='<hash key>'

# 2. Install (file state on a PVC that survives uninstall).
helm install payrekha deploy/helm/payrekha

# Or keep state in Postgres (add PAYREKHA_STATE_PG_URL to the secret first).
helm install payrekha deploy/helm/payrekha --set state.type=postgres \
  --set 'networkPolicy.egress[0].ports[0].port=5432'
```

| Value | Default | Notes |
|---|---|---|
| `existingSecret` | `payrekha` | Secret with `PAYREKHA_*` keys, loaded with `envFrom`. |
| `config` | `{firewall: {mode: shadow}}` | Rendered to `/etc/payrekha/payrekha.json`. Changing it rolls the pod. |
| `state.type` | `file` | `file` (PVC, `helm.sh/resource-policy: keep`) or `postgres`. |
| `replicaCount` | `1` | Rendering fails for `file` with more than 1. Keep 1 for `postgres` too: a second writer goes unready. |
| `decisionLog.format` | `jsonl` | `jsonl` or `cef`, written to `/var/lib/payrekha/decisions.jsonl`. Ship it with your log agent. |
| `networkPolicy.clientPodSelector` | `payrekha-client: "true"` | Label your payout service or Envoy pods with this. |
| `networkPolicy.prometheusNamespaceSelector` | `monitoring` namespace | Who may scrape `/metrics`. |
| `networkPolicy.egress` | `[]` | Add Postgres and your SOAR webhook. DNS is always allowed. |

The Deployment uses `strategy: Recreate` so a rollout never runs two writers, and `terminationGracePeriodSeconds: 30` so the snapshot is saved on SIGTERM. See [operations](../operations.md#state-and-restarts) for how state loading fails closed.
