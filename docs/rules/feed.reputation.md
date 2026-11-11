# `feed.reputation`

**Default verdict:** REVIEW or BLOCK

**Fires when:** The hashed beneficiary — account+IFSC, VPA, mobile, or VDA address — is on an operator-loaded fraud feed (your own list, a consortium list, or an I4C/CFCFRMS suspect extract, loaded from a file — no network calls).

The rule checks `beneficiaryRef` against the feed, plus `beneficiaryMobileRef` when present; if both hit, the worse band wins and evidence records which ref matched (`matched: beneficiary|mobile`).

**Attack it answers:** Known mule accounts and re-used suspect identifiers — the exact shape CIAD-2026-0058 mule networks take.

**Configuration:** Feed file (`feedSnapshot` in `payrekha.json`); `blockAt`, `reviewAt` risk bands. Snapshot format — `{version: 1, source, entries: [...]}` where each entry carries a band plus one identifier:

| Field                  | Meaning                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ref`                  | an `hb1_…` ref already hashed with your PayRekha key (any beneficiary type — no hash key needed at load)                       |
| `beneficiary`          | a raw `{account,ifsc}` / `{vpa}` / `{mobile}` / `{address,network}` — hashed on load and discarded (needs `PAYREKHA_HASH_KEY`) |
| `mobile` / `mobileRef` | legacy spellings for mobile entries — still accepted                                                                           |

`scripts/csv-to-feed-snapshot.mjs` converts an operator CSV (`kind,value,aux,band,source` columns) into this snapshot — raw identifiers are hashed to `hb1_` refs and never written to disk: `node scripts/csv-to-feed-snapshot.mjs --in mules.csv --source i4c-cfcfrms > feed-snapshot.json`. See `examples/data/mule-list.csv`.

**Known false positives:** Stale feed entries. Expire entries in your feed pipeline.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
