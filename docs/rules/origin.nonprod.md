# `origin.nonprod`

**Default verdict:** BLOCK

**Fires when:** The call comes from a non-production origin: the authenticated API key is marked `nonprod`, or the request carries a UAT/staging marker.

**Attack it answers:** Pivot from exposed UAT/staging into production payouts.

**Configuration:** Key origins in `PAYREKHA_API_KEYS`; `nonProdKeyIds`, `nonProdKeyPrefixes`, `unknownOrigin` (`ignore` or `review`).

**Known false positives:** A prod service accidentally using a UAT key. That is exactly what should stop.

**Scope note — what `origin` does and does not see.** The rule binds the *environment of the credential or route*, asserted by your gateway/Envoy — never the request body, and not the caller's IP or network segment. On `/v1/evaluate` it comes from the API key's configured `origin`; on `ext_authz` from the Envoy listener config or an Envoy-asserted header. Two consequences:

- **Keys must be per-environment.** If one key id serves both UAT and prod, `origin` cannot tell a UAT-network call from a prod one — the defence falls back to the intent binding (still BLOCK without intent) and behaviour rules. Issue separate keys per environment; `PAYREKHA_API_KEYS` requires an `origin` per key for exactly this reason.
- **An untagged origin is only visible if someone marks it.** `/v1/evaluate` and `ext_authz` always assert `prod|nonprod`; `unknown` only arises in SDK embeddings that honestly mark untagged calls — set `unknownOrigin: "review"` there.
- **Pin each caller's expected environment** with `rules.origin.keyOrigins` (`sourceKeyId → 'prod'|'nonprod'`): a nonprod-intended caller arriving on a prod route under an unfamiliar name produces [`origin.mismatch`](origin.mismatch.md) REVIEW evidence instead of slipping through.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
