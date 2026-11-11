# ADR 0003 — m-of-n multi-approval intents

- Status: accepted
- Date: 2026-11-07

## Context

CERT-In CIAD-2026-0058 RA19 calls for multi-signature (m-of-n) controls on
crypto/VDA withdrawals. Today a payout binds exactly **one** intent
(`PayoutRequest.intentId`): one compromised or coerced system-of-record key
authorises the money alone. For `VDA_WITHDRAWAL` — the kind the advisory
names — single-issuer authorisation is the weakest link.

Requirements the design must satisfy:

- Approvers are **different trust zones**, not the same key signing twice.
- Reuse the existing machinery: intents are already "a signed statement that
  money may move" — an approval is the same object from a different issuer.
- Consumption, release and settle must stay idempotent per `payoutId` and
  backwards-compatible with existing snapshots.
- No new endpoints: approver systems register intents through `/v1/intents`
  (or mint) exactly as they do today.

## Options considered

**A. `approvalIds[]` on the payout — chosen.** The payout cites its primary
`intentId` plus zero or more additional registered intent ids. Each cited
approval is an ordinary intent: verified on receipt, bound to the same kind
and beneficiary, consumed per payout. `firewall.requiredApprovals:
{ VDA_WITHDRAWAL: 2 }` declares the minimum count of distinct-issuer intents
a kind must cite — `2` is maker+checker; absent means today's behaviour.

**B. m-of-n composite signature on one intent.** One intent carrying a set of
signatures. Rejected: it changes the canonical payload and the verify path,
hides "who approved" inside one blob, and makes each approver's approval
bound to the moment of signing rather than independently registered and
audited.

**C. A separate `Approval` object type + `/v1/approvals`.** Rejected: it
duplicates the intent registry, keyring, idempotency and snapshot machinery
for a shape that is already an intent.

## Decision

- `PayoutRequest.approvalIds?: readonly string[]` — additional intent ids,
  at most 8, each a string. Always validated when cited, even for kinds that
  do not require approvals: a submitted bad approval is evidence, never a
  free pass.
- `FirewallConfig.requiredApprovals?: Partial<Record<IntentKind, number |
ApprovalRequirement>>` — the minimum number of intents the kind must cite,
  **including** the primary. `requiredApprovals: { VDA_WITHDRAWAL: 2 }` = the
  primary intent plus one approval, from two distinct issuers. A bare count
  is sugar for strict enforcement; `ApprovalRequirement` is the stakeholder
  tuning surface:

  ```ts
  interface ApprovalRequirement {
    count: number; // ≥ 2, primary included
    onInsufficient?: 'block' | 'review'; // 'review' holds (HOLD) instead
    // of declining — the ramp mode
    approverIssuers?: readonly string[]; // only these issuers count
  }
  ```

  `onInsufficient: 'review'` is how a lender adopts the control without
  jamming business flow while approver systems onboard: the safeguard is on,
  insufficiency routes to the maker-checker hold queue instead of a decline.
  `approverIssuers` stops a caller satisfying the count with any registered
  intent — pin it to the risk desk's keyring so approval means a _separate
  organisation unit_ signed, not just a second signature.

- An approval must satisfy the same binding as the primary: signature `ok`,
  `kind` equal, `beneficiaryRef` equal, `maxAmountPaise ≥ amountPaise`,
  inside its validity window — **and** its `issuer` must differ from the
  primary's and from every other cited approval's. Distinct keyIds under one
  issuer is one entity signing twice; the check is on issuer.
- New `IntentStatus` values on the check result: `approvals-insufficient`
  (fewer than required — verdict follows `onInsufficient`),
  `approvals-not-distinct` (repeated issuer — always BLOCK: that is an
  attempted bypass, not a shortfall), and `approvals-invalid` (bad
  signature, kind/beneficiary mismatch, expired, amount-short, consumed or
  unregistered id — always BLOCK: a cited bad approval is evidence).
- `IntentCheck` gains `approvals: { required, provided, issuers }` for the
  decision record — auditors can see _who_ approved, not just that someone did.
- Reservations bind `payoutId → all cited intentIds`. `reserve` consumes a
  use on each; `release`/`settle` restore all of them. Snapshot rows gain an
  optional `approvalIds` field — snapshots written before this feature load
  unchanged.
- Approver separation is about **issuers**, enforced at evaluation. Minted
  intents can serve as approvals mechanically, but approvals minted by the
  same gateway the payout caller reaches are one host again — the doc steers
  real deployments to external approver signing.

## Consequences

- `/v1/intents` and mint need no changes; approvers are just more issuers in
  `issuers[]` with kind scope.
- FieldMapping gains `approvalIds` (array path or comma-joined header) for
  ext_authz callers; SDK callers pass the array.
- Ops runbook gains one line: an approver system going quiet surfaces as
  `approvals-insufficient` BLOCKs — distinguishable from `intent.missing`
  (nobody authorised) by the decision-record `approvals` evidence.
- Cost: one registry lookup per cited approval — bounded at 8.
