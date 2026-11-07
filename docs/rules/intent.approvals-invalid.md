# `intent.approvals-invalid`

**Default verdict:** BLOCK

**Fires when:** A cited `approvalIds` entry fails the same binding the primary must satisfy: unregistered id, bad signature, wrong kind, outside its validity window, different beneficiary, amount above its remaining ceiling, or already consumed by another payout.

**Attack it answers:** Forged or replayed approvals attached to a payout — a stale, mismatched or re-spent "second signature" is evidence of an attempt, never a free pass. Approvals are validated even on kinds with no `requiredApprovals` configured.

**Configuration:** None beyond `firewall.requiredApprovals`.

**Known false positives:** A legitimate approver re-using a single-use approval intent across two payouts — approvers must sign per payout (`maxUses: 1` per approval intent, one withdrawal = one approval).

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence` (`detail` names the failing approval). Tests: `packages/rules/test/rules.test.ts`.
