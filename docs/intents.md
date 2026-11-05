# Intents: two keys to move money

A stolen payout credential should not be enough to move money. Payrekha separates two powers:

- **Deciding** that money should move. Your LOS sanctions the loan, your reconciliation engine settles the merchant, your withdrawal approver clears the withdrawal. That system signs an **intent**.
- **Moving** money. Your payout service calls the bank. Payrekha lets the call through only if it presents a matching intent.

An attacker who owns the payout service, or its API key, still needs the intent-signing key. That key lives in a different system, ideally in an HSM or KMS.

## The intent

```json
{
  "intentId": "loan-88213",
  "kind": "LOAN_DISBURSAL",
  "maxAmountPaise": 24000000,
  "beneficiaryRef": "hb1_npufAAjgVogy10semYTmyIh1DQ5iKaKbFx15JglFEUs",
  "subjectRef": "app-55102",
  "maxUses": 1,
  "notBeforeMs": 1793000000000,
  "expiresAtMs": 1793086400000,
  "issuer": "los",
  "keyId": "los-2026-11",
  "signature": "…"
}
```

Kinds: `LOAN_DISBURSAL`, `PA_SETTLEMENT`, `REFUND`, `VDA_WITHDRAWAL`, `VENDOR_PAYOUT`, `VERIFICATION`. Each issuer key lists the kinds it may sign. A refund key cannot mint disbursal intents.

When a payout carries an intent, the rules check six things: the signature (`intent.bad-signature`), the kind (`intent.kind-mismatch`), the validity window (`intent.expired`), the amount ceiling (`intent.amount-exceeds`), the beneficiary (`intent.beneficiary-mismatch`) and the number of uses (`intent.reused`). Payout kinds that require an intent and arrive without one hit `intent.missing`.

## Signing

The payload is `payrekha-intent-v1\n` followed by the canonical JSON of the intent without `signature`. In canonical JSON the keys are sorted, undefined values are omitted, and numbers must be safe integers, so a float amount cannot be signed. The TypeScript, Java and Python implementations produce byte-identical payloads; `clients/vectors/intent-v1.json` is the shared test.

- **Ed25519 (default).** The issuer holds the private key; Payrekha only holds public keys, so nobody who breaks into Payrekha can mint intents.
- **HMAC-SHA256.** Supported for systems that cannot do Ed25519. Payrekha warns at boot because anyone holding the secret can mint intents. Use a secret of at least 32 characters.

```python
from payrekha import hash_beneficiary, sign_intent_ed25519
ref = hash_beneficiary(HASH_KEY, account="000123456789", ifsc="HDFC0001234")
intent = sign_intent_ed25519({...,"beneficiaryRef": ref}, private_key)
```

## Key rotation and revocation

Each key has a `keyId`, so you can run old and new keys side by side while you rotate. Revoking a key re-checks every intent it signed that has not yet been used, and those intents then fail with `intent.bad-signature`. An intent that fails registration is kept as a tombstone, so it cannot be registered again under the same ID.

## Beneficiary binding

`beneficiaryRef` is `hb1_` + base64url(HMAC-SHA256(hash key, normalised identifier)). The LOS and Payrekha share the hash key (at least 16 bytes); the raw account number never needs to reach Payrekha. Account+IFSC, VPA and mobile are each normalised before hashing.
