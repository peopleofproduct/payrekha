# Evidence extraction — pulling an incident timeline from decisions.jsonl

Copy-paste jq for the CERT-In/CSIRT-Fin + I4C/CFCFRMS report (the filing
itself is the operator's job — A8). Everything below runs on the raw log;
no tooling beyond `jq` (≥1.6) and standard unix tools.

## 1. Establish the window

```sh
# First anomaly: earliest BLOCK or REVIEW in the file
jq -rs '[.[] | select(.type=="decision" and .verdict!="ALLOW")] | sort_by(.ts)[0] | {ts, payoutId, verdict, rules}' decisions.jsonl
# Alert entry (if the attack raised HIGH_ALERT)
jq -r 'select(.type=="audit" and .action=="alert.enter") | [.ts,.actor,.detail] | @tsv' decisions.jsonl
```

## 2. The attack timeline

```sh
# Chronological non-ALLOW decisions with rule ids — the report's core table
jq -rs '[.[] | select(.type=="decision" and .verdict!="ALLOW")] | sort_by(.ts)[]
  | [.ts, .payoutId, .kind, .amountPaise, .verdict, (.rules|join("+")), .sourceKeyId] | @tsv' decisions.jsonl

# Per-rule counts across the window — "what did the attacker try"
jq -r 'select(.type=="decision" and .verdict!="ALLOW") | .rules[]' decisions.jsonl | sort | uniq -c | sort -rn
```

## 3. Exposure & attribution

```sh
# Money that would have moved (BLOCK+REVIEW under enforce = prevented)
jq -rs '[.[] | select(.type=="decision" and .verdict=="BLOCK")] | (map(.amountPaise // 0) | add) / 100 | "₹\(.)"' decisions.jsonl

# Which API keys / sources carried the attack
jq -r 'select(.type=="decision" and .verdict!="ALLOW") | .sourceKeyId' decisions.jsonl | sort | uniq -c | sort -rn

# Source-network hints seen on blocked payouts (untrusted evidence — correlate, don't assert)
jq -r 'select(.type=="decision" and .verdict=="BLOCK") | .sourceHint // "-"' decisions.jsonl | sort | uniq -c | sort -rn
```

## 4. Beneficiary set for the I4C bulk report

```sh
# Distinct hashed refs on blocked payouts (hb1_ only — resolve to real
# accounts inside YOUR system of record; PayRekha deliberately cannot)
jq -r 'select(.type=="decision" and .verdict=="BLOCK") | .beneficiaryRef // empty' decisions.jsonl | sort -u
```

## 5. Integrity statements for the report

```sh
# Record counts (declare the evidence volume)
wc -l decisions.jsonl
# Any log-write gap window (check before attesting completeness)
grep 'decision-log' gateway-stderr.log 2>/dev/null | head
# alert lifecycle for the window
jq -r 'select(.type=="audit" and (.action|startswith("alert"))) | [.ts,.action,.actor] | @tsv' decisions.jsonl
```

CERT-In wants the format in their incident-reporting guidelines — this
produces the _content_; `docs/runbook.md` covers the filing steps and
timelines. Always extract from the SIEM copy too and diff counts: two
independent log copies is a materially stronger attestation.
