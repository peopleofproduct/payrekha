# PayRekha segment kits

One directory per stakeholder: a preset `payrekha.json`, a deterministic
month of _their_ payout shapes, and a demo that runs cold.

```bash
npm run kit:lender   # gen data + replay → kits/lender/out/report.html
npm run kit:pa
npm run kit:psp
npm run kit:crypto
```

Each kit's README explains: the preset's thresholds and _why_, which planted
anomalies the month contains, what the replay report should show, your
first-week runbook (shadow → tune → enforce), and the CERT-In advisory rows
the kit exercises.

| Kit      | Money path                      | Headline control                     |
| -------- | ------------------------------- | ------------------------------------ |
| `lender` | penny-drop → disbursal → refund | signed intents per loan              |
| `pa`     | T+1 merchant settlements        | merchant account-change window       |
| `psp`    | refunds + new-payee verifies    | probe/cooling on fresh beneficiaries |
| `crypto` | VDA withdrawals                 | **m-of-n maker-checker** (ADR 0003)  |

Regenerate data any time — deterministic seeds, no network calls:

```bash
node kits/<seg>/gen-data.mjs
npm run replay -- --payouts kits/<seg>/data/payouts.csv \
  --intents kits/<seg>/data/intents.csv \
  --config kits/<seg>/payrekha.json --out kits/<seg>/out
```
