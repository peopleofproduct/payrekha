# `identity.fingerprint`

**Default verdict:** ALLOW on enrolment, REVIEW on change (`onChange: 'block'|'evidence'` configurable)

**Fires when:** An API key presents an edge-asserted `sourceHint` that differs from the hint it enrolled with — the credential is being used from somewhere new. The first hint a key ever presents enrols it (ALLOW-severity evidence); each later transition fires once and re-enrols.

**Attack it answers:** Token usage from unusual sources (CERT-In CIAD-2026-0058 RA12) — a stolen payout key or Envoy credential replayed from attacker infrastructure instead of the service's usual egress.

**Where the hint comes from — always the edge, never the body:**

- `/v1/evaluate`: the socket peer IP, stamped by the gateway. Body-supplied `sourceHint` is dropped.
- `ext_authz`: `mapping.sourceHint` — point it at proxy-asserted headers (`header.x-envoy-external-address`, `header.user-agent`, an auth-derived claim). An array composes parts, joined `|`.

**Configuration:** `rules.fingerprint.onChange` — `review` (default, HOLDs in enforce), `evidence` (log only, for keys behind legitimately-rotating egress), `block` (for keys whose source must never move). `maxTrackedKeys` bounds the LRU (default 100k). Enrolment survives snapshots.

**Know the false positive class:** an edge hint that legitimately rotates (NAT pool, autoscaled pods behind a changing LB IP) will fire on every transition. Compose the hint for stability — map a subnet/ASN-shaped header rather than the raw IP, or set `onChange: 'evidence'` and let the SIEM correlate. Geographic/ASN anomaly scoring itself stays SIEM-side: `sourceHint` lands in the decision record (and CEF `src` when the hint is a bare IP).

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
