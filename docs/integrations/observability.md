# Observability — Datadog, New Relic, OTel, managed Prometheus

The contract is one Prometheus text endpoint — `GET /metrics` on the
gateway, authenticated by a `read`-role API key. Everything below is
collector-side config; PayRekha itself stays zero-dependency.

Grafana users get the finished dashboard (`deploy/grafana/dashboards/
payrekha.json`, two-click import) and alert rules
(`deploy/prometheus/alerts.yml`). The metric names below are the same
everywhere — dashboards in other tools rebuild on them directly.

## Managed Prometheus (Grafana Cloud / Amazon MWAA-P / etc.)

Point any Prometheus-compatible scraper at the endpoint with the key:

```yaml
scrape_configs:
  - job_name: payrekha
    scheme: https                      # terminate TLS at your ingress/LB
    authorization:
      type: Bearer
      credentials: <read-role-api-key> # PAYREKHA_API_KEYS …:read:…
    static_configs:
      - targets: ['payrekha.internal:8080']
    scrape_interval: 15s
```

On Kubernetes use the chart's `serviceMonitor` — it templates the
`bearerTokenSecret` reference for you (`deploy/helm/payrekha/values.yaml`).

## Datadog

Use the OpenMetrics integration on the Agent (or cluster-agent check):

```yaml
# conf.d/openmetrics.d/conf.yaml — or the AD annotation equivalent
init_config:
instances:
  - openmetrics_endpoint: http://payrekha:8080/metrics
    namespace: payrekha
    metrics: ['payrekha_*']            # the whole prefix
    headers:
      Authorization: Bearer <read-role-api-key>
```

Minimum dashboard widgets: `payrekha_verdicts_total` by verdict (rate),
`payrekha_eval_latency_micros` p99, `payrekha_degraded_total`,
`payrekha_decision_log_errors_total` + `payrekha_state_save_errors_total`
(monitors, >0 = investigate), `payrekha_shared_failclosed_total`
(active-active only, >0 = page).

## New Relic

The Prometheus remote-write or the OpenMetrics integration both work —
the OpenMetrics endpoint path is simpler:

```yaml
# nri-prometheus / openmetrics config
targets:
  - description: payrekha
    urls: ["http://payrekha:8080/metrics"]
    labels: { service: payout-firewall }
    tls_config: {}
    http_headers:
      Authorization: ["Bearer <read-role-api-key>"]
```

## OpenTelemetry Collector

```yaml
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: payrekha
          authorization: { type: Bearer, credentials: <read-role-api-key> }
          static_configs:
            - targets: ['payrekha:8080']
exporters:
  otlphttp:
    endpoint: https://<your-backend>/v1/metrics
service:
  pipelines:
    metrics:
      receivers: [prometheus]
      exporters: [otlphttp]
```

## The alert shortlist (any backend)

| Condition | Why |
|---|---|
| `increase(payrekha_shared_failclosed_total[5m]) > 0` | store wobble → verdicts failing closed — page |
| `increase(payrekha_decision_log_errors_total[5m]) > 0` | audit gap window — investigate before attesting |
| `increase(payrekha_state_save_errors_total[15m]) > 0` | restart would replay stale state |
| `payrekha_high_alert == 1` | an alert needs a human, by design forever |
| `rate(payrekha_verdicts_total{verdict="BLOCK"}[5m])` vs baseline | attack or a config regression — either way, look |
| `histogram_quantile(0.99, payrekha_eval_latency_micros)` drift | verdict-path latency budget |

Log side: `deploy/siem/` ships the Vector shipper + query packs for
Splunk (`splunk.spl`), Sentinel (`sentinel.kql`), Elastic (`elastic.esql`)
— `docs/integrations/siem.md` is the companion page.
