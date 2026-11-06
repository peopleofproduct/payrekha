# `intent.bad-signature`

**Default verdict:** BLOCK

**Fires when:** The intent's signature does not verify, its key is unknown or revoked, or the key is not allowed to sign this kind.

**Attack it answers:** Forged or tampered intents; intents signed with a revoked key.

**Configuration:** Issuer keys in config (`issuers[]`), rotation by `keyId`.

**Known false positives:** Key rotated in the LOS before the new public key was added to PayRekha. Add the new key first, then switch the LOS.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence`. Tests: `packages/rules/test/rules.test.ts`.
