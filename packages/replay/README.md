# @payrekha/replay

The zero-integration evaluation tool: run your historical payouts through
the PayRekha rules and get terminal, HTML and JSON reports — including the
**false-positive review list** you tune from. This is day 0 of a PayRekha
pilot: your own data, one command, nothing deployed.

```bash
payrekha-replay --payouts ledger.csv --map map.json --out out/
# open out/report.html
```

`map.json` renames your columns to PayRekha fields (`payoutId`, `kind`,
`amountRupees`, `timestamp`, `account`, `ifsc`, `sourceKeyId`, …). Without
`--intents` it runs intent-less mode — behaviour, environment and settlement
rules still fire. Beneficiaries are hashed with a throwaway key per run, so
reports never contain a raw account number. See `docs/pilot-day1.md` and
`docs/getting-started.md` in the repo.

Apache-2.0.
