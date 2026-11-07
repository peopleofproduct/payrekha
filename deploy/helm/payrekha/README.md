# payrekha — production Helm profile

Installs the PayRekha payout-firewall gateway with the controls a money path
should ship with by default: one fenced writer (or an ADR 0004 active-active
set), non-root read-only-root pods, default-deny egress, PDB, and Prometheus
Operator scraping.

## Quick start

```bash
kubectl create secret generic payrekha \
  --from-literal=PAYREKHA_API_KEYS='lms:prod:…,reg:prod:intents:…' \
  --from-literal=PAYREKHA_ADMIN_KEY='…' \
  --from-literal=PAYREKHA_HASH_KEY='…' \
  --from-literal=PAYREKHA_STATE_KEY='≥32 chars…'
helm install payrekha ./deploy/helm/payrekha -n payrekha --create-namespace
```

Shadow mode is the default — it never blocks, only logs. Enforce after
replaying real traffic.

## Topologies

| `topology` | Writers | HA story |
|---|---|---|
| `single` (default) | 1 | PVC/Postgres snapshot + `Recreate` rollout. Optional `standby.enabled` adds a second Deployment **kept at `standby.replicas: 0`** — promote with `kubectl scale deploy/<name>-standby --replicas=1` after fencing the old primary to 0. A live second writer is never allowed: the snapshot CAS makes it permanently unready. |
| `activeActive` | ≥2 | ADR 0004: every replica commits intent consumption through one Postgres transaction (`PAYREKHA_SHARED_PG_URL` in the secret, `config.gateway.sharedState` in the configmap). Rolling updates with `maxUnavailable: 0` + PDB `minAvailable: 1` — the money path never dips below one serving replica through drains. |

Invalid combinations fail at `helm template`/`install` time — e.g.
`topology=single` with `replicaCount: 2`, or `activeActive` without
`config.gateway.sharedState`.

## Hardening checklist

- [ ] `existingSecret` populated (chart never takes secret values — see
      values.yaml for the key list) or `externalSecrets.enabled` wired to
      your SecretStore.
- [ ] `networkPolicy.enabled` (default) — set
      `clientPodSelector` to your payout service / Envoy pods and
      `networkPolicy.postgresTo` when `state.type=postgres` or
      `topology=activeActive`. Egress is default-deny except DNS.
- [ ] `serviceMonitor.enabled` + a `read`-role token in
      `bearerTokenSecret` — alert on `payrekha_shared_failclosed_total`,
      `payrekha_high_alert`, and `payrekha_state_save_errors_total`.
- [ ] `priorityClassName` set where the cluster preempts burstable pods.
- [ ] `resources` sized to your envelope — `docs/capacity-envelope.md`.
- [ ] `state.file.storageClassName` set when `state.type=file` (RWO volume
      keeps HIGH_ALERT + reservations across restarts; PVC is `keep`-annotated
      so `helm uninstall` never deletes it).

## Upgrades

`helm.sh/chart` labels + `checksum/config` annotation roll pods on config
change. Snapshot format is forward-compatible within a minor line — see
docs/runbook.md for rollback.
