# Kubernetes

A Helm chart is coming. Until then, the essentials:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: payrekha }
spec:
  replicas: 1                      # one replica per state file until the shared store lands
  strategy: { type: Recreate }
  template:
    spec:
      securityContext: { runAsNonRoot: true, runAsUser: 1000, fsGroup: 1000, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: payrekha
          image: ghcr.io/peopleofproduct/payrekha:v0.1.0-alpha.0
          ports: [{ containerPort: 8080 }]
          envFrom: [{ secretRef: { name: payrekha } }]   # PAYREKHA_API_KEYS, PAYREKHA_ADMIN_KEY, PAYREKHA_HASH_KEY, …
          env:
            - { name: PAYREKHA_CONFIG, value: /etc/payrekha/payrekha.json }
            - { name: PAYREKHA_STATE_FILE, value: /var/lib/payrekha/state.json }
            - { name: PAYREKHA_DECISION_LOG, value: /var/lib/payrekha/decisions.jsonl }
          securityContext: { readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities: { drop: [ALL] } }
          readinessProbe: { httpGet: { path: /readyz, port: 8080 } }
          livenessProbe: { httpGet: { path: /healthz, port: 8080 } }
          volumeMounts:
            - { name: config, mountPath: /etc/payrekha, readOnly: true }
            - { name: state, mountPath: /var/lib/payrekha }
      terminationGracePeriodSeconds: 30   # state is saved on SIGTERM
      volumes:
        - { name: config, configMap: { name: payrekha } }
        - { name: state, persistentVolumeClaim: { claimName: payrekha-state } }
```

Add a NetworkPolicy so that only the payout service (or Envoy) can reach :8080, and only Prometheus can scrape `/metrics`. Allow egress only to your SOAR webhook.
