# SIEM: Splunk, Sentinel, Elastic

Every decision is one line in `PAYREKHA_DECISION_LOG`. It is JSONL by default; set `PAYREKHA_LOG_FORMAT=cef` for CEF. There are no raw account numbers, VPAs or mobiles in the log, only `hb1_` hashes.

```json
{"ts":"2026-11-05T10:12:03.114Z","requestId":"…","decisionId":"pd_lWbT…","path":"ext_authz","mode":"enforce","alertState":"NORMAL","verdict":"BLOCK","effectiveAction":"DECLINE","degraded":false,"rules":["intent.missing"],"hits":[{"rule":"intent.missing","verdict":"BLOCK","reason":"No intent on this LOAN_DISBURSAL payout — no matching intent, no payout","evidence":{…}}],"kind":"LOAN_DISBURSAL","amountPaise":24000000,"beneficiaryRef":"hb1_…","sourceKeyId":"lms","origin":"prod"}
```

CEF: `CEF:0|People of Product|Payrekha|0.1.0|<rule>|<reason>|<severity>|…` (BLOCK 9, REVIEW 6, ALLOW 1).

- **Splunk:** Universal Forwarder monitoring the file with `sourcetype=_json`. Search: `index=payrekha verdict=BLOCK | stats count sum(amountPaise) by sourceKeyId rules{}`.
- **Microsoft Sentinel:** Azure Monitor Agent custom JSON log table, or CEF via the Syslog/CEF connector. KQL: `Payrekha_CL | where verdict == "BLOCK" | summarize count() by sourceKeyId, bin(TimeGenerated, 5m)`.
- **Elastic:** Filebeat `filestream` input with the `ndjson` parser.

Alert on: any `canary.tripped`; `alertState == "HIGH_ALERT"`; `path == "admin"` (mode changes and resets); `origin == "nonprod"`; and `degraded == true` bursts.

**Webhooks (SOAR):** set `PAYREKHA_WEBHOOK_URL` and `PAYREKHA_WEBHOOK_SECRET`. BLOCK and HIGH_ALERT events are POSTed asynchronously with retry and backoff, so they never delay a verdict. Verify them with `x-payrekha-signature: sha256=HMAC(secret, "<x-payrekha-timestamp>.<body>")`.
