# `intent.approvals-not-distinct`

**Default verdict:** BLOCK

**Fires when:** Two cited intents — primary or any `approvalIds` entry — carry the same `issuer`. Two keyIds under one issuer is one entity signing twice.

**Attack it answers:** An attacker satisfying the approval count with a second signature from the *same* compromised system — m-of-n collapsed back to m-of-one. This is attempted bypass, not shortfall, so it always BLOCKs (unlike `intent.approvals-insufficient`, which may HOLD while approvers onboard).

**Configuration:** None beyond `firewall.requiredApprovals`; distinctness is always enforced on every cited intent, for every kind, even kinds without a requirement — a cited approval is always checked.

**Known false positives:** None expected — a correctly configured deployment registers approvers under distinct issuers.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence` (`issuers`). Tests: `packages/rules/test/rules.test.ts`.
