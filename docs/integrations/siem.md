# SIEM: Splunk, Sentinel, Elastic

Every decision is one line in `PAYREKHA_DECISION_LOG`. It is JSONL by default; set `PAYREKHA_LOG_FORMAT=cef` for CEF. There are no raw account numbers, VPAs or mobiles in the log, only `hb1_` hashes.

```json
{"ts":"2026-11-05T10:12:03.114Z","requestId":"…","decisionId":"pd_lWbT…","path":"ext_authz","mode":"enforce","alertState":"NORMAL","verdict":"BLOCK","effectiveAction":"DECLINE","degraded":false,"rules":["intent.missing"],"hits":[{"rule":"intent.missing","verdict":"BLOCK","reason":"No intent on this LOAN_DISBURSAL payout — no matching intent, no payout","evidence":{…}}],"kind":"LOAN_DISBURSAL","amountPaise":24000000,"beneficiaryRef":"hb1_…","sourceKeyId":"lms","origin":"prod"}
```

CEF: `CEF:0|People of Product|Payrekha|0.1.0|<rule>|<reason>|<severity>|…` (BLOCK 9, REVIEW 6, ALLOW 1).

- **Splunk:** Universal Forwarder monitoring the file with `sourcetype=_json`. Search: `index=payrekha verdict=BLOCK | stats count sum(amountPaise) by sourceKeyId rules{}`. Ready-made queries: [`deploy/siem/queries/splunk.spl`](../../deploy/siem/queries/splunk.spl).
- **Microsoft Sentinel:** Azure Monitor Agent custom JSON log table, or CEF via the Syslog/CEF connector. KQL: `Payrekha_CL | where verdict == "BLOCK" | summarize count() by sourceKeyId, bin(TimeGenerated, 5m)`. Ready-made queries: [`deploy/siem/queries/sentinel.kql`](../../deploy/siem/queries/sentinel.kql).
- **Elastic:** Filebeat `filestream` input with the `ndjson` parser. Ready-made ES|QL queries: [`deploy/siem/queries/elastic.esql`](../../deploy/siem/queries/elastic.esql).

## Correlation content — tuned to CIAD-2026-0058 (RA23)

The advisory tells SOCs to correlate for *machine-speed, multi-technique attack patterns — parallel threads, payload mutation, continuous non-business-hours operation against a single target*. The query packs above map those to log patterns:

| Advisory pattern | Query | What fires |
|---|---|---|
| Multiple tools/techniques on one target | #1 multi-technique burst | ≥3 distinct rule ids on one `sourceKeyId` in 10 min — an autonomous agent enumerating defences |
| Credential abuse at machine speed | #2 `intent.missing` burst | Payout API worked without authorisation; also watch `intent.bad-signature` |
| Non-business-hours operation | #3 IST off-hours (23:00–06:00) | Activity when the SOC is thin; `calendar.window` hits corroborate |
| Payload mutation / probing | #4 `degraded` burst | Malformed-input scanning, or a rule that started throwing |
| Deception touched | #5 canary + `alert.*` audit | Page immediately — HIGH_ALERT follows |
| Micro-value → large test flows | #6 `probe.micro-then-large` | The ₹1-then-large precursor with minutes/multiple evidence |
| Settlement abuse | #7 `settlement.*` hits | Account-swap holds and over-captured settlements |
| UAT→prod pivot | #8 `origin.nonprod` / nonprod origin | Non-prod keys or segments reaching for production money |
| Authorization tampering | #9 `outcome.denied` audit | A foreign key trying to free a bound intent |
| Single-target pressure | #10 per-beneficiary view | Every technique tried against one account/VPA/address |

Tune the thresholds (`≥3 techniques`, `≥5`, `≥10`) after shadow data shows your baseline — these are starting points, not universal constants.

Alert on: any `canary.tripped`; `alertState == "HIGH_ALERT"`; `path == "admin"` (mode changes and resets); `origin == "nonprod"`; `degraded == true` bursts; `action:"outcome.denied"`; and `time.skew` hits.

**Webhooks (SOAR):** set `PAYREKHA_WEBHOOK_URL` and `PAYREKHA_WEBHOOK_SECRET`. BLOCK and HIGH_ALERT events are POSTed asynchronously with retry and backoff, so they never delay a verdict. Verify them with `x-payrekha-signature: sha256=HMAC(secret, "<x-payrekha-timestamp>.<body>")`.
