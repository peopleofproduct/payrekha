# PCI-DSS touchpoints

PayRekha never sees cardholder data — payouts carry `hb1_` refs and
paise, no PAN/CVV/track data exists in its data model. It is **out of
PCI scope by data flow**, which is itself the useful audit answer: it
shrinks, rather than joins, your cardholder-data environment.

Where a card-adjacent entity still touches it:

| PCI theme                           | Touchpoint                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Req 3 — protect stored account data | None — no PAN field exists; beneficiary refs are keyed HMACs (see `dpdp.md`)                              |
| Req 6 — secure development          | `repository-settings.md`: signed commits, pinned CI, provenance; `npm run fuzz`                           |
| Req 7 — need-to-know access         | Role-scoped API keys + separate admin token (`audit-pack/access-model.md`)                                |
| Req 8 — identify/authenticate       | Bearer keys (SHA-256 stored); human auth is **your IdP/proxy's job** — put SSO in front of admin surfaces |
| Req 10 — logging & monitoring       | `decisions.jsonl` + `audit` records + Prometheus metrics (schema in `audit-pack/decision-log-schema.md`)  |
| Req 11 — testing                    | Drills D1–D9, failure-mode matrix, fuzz suite                                                             |

**The useful framing for a QSA**: PayRekha is a compensating-control
candidate on the _payout authorization_ boundary — "even with valid API
credentials, a payout cannot execute without a pre-signed business
intent" is a strong story for segmentation/authorization requirements —
but it does not itself handle CHD, so it neither expands your scope nor
discharges any CHD requirement.
